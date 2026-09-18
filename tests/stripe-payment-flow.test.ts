import { beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Cobertura server-side do startStripeCheckout e do webhook.
//
// Prova os invariantes financeiros: o browser envia apenas orderId/locale;
// valor/moeda enviados a Stripe vem do DB (snapshot do pedido); a confirmacao
// usa o amount/currency REPORTADOS PELO EVENTO Stripe, jamais o snapshot.

const { MockStripeError, adminRpc, adminFrom, serverClientMock, providerMock } = vi.hoisted(() => ({
  MockStripeError: class MockStripeError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
  serverClientMock: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
  providerMock: {
    createPaymentIntent: vi.fn(),
    retrieveCheckoutSession: vi.fn(),
    parseWebhookEvent: vi.fn(),
    idempotencyKeyFor: vi.fn((orderId: string) => "checkout_" + orderId),
  },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    rpc: adminRpc,
    from: adminFrom,
  })),
  createSupabaseServerClient: vi.fn(async () => serverClientMock),
}));

vi.mock("@/services/stripe-payment", () => ({
  StripePaymentError: MockStripeError,
  getStripePaymentProvider: vi.fn(() => providerMock),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { startStripeCheckout } from "@/services/stripe-payment-flow";
import { POST as stripeWebhook } from "@/app/api/payments/stripe/webhook/route";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeOrderRow(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    user_id: userId,
    total_cents: 7500,
    currency: "BRL",
    paid_at: null,
    status: "pending_payment",
    ...overrides,
  };
}

function fromReturning(result: { data: unknown; error: unknown }) {
  return vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: vi.fn(async () => result),
      }),
    }),
  }));
}

function emptyPaymentsQuery() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => ({
            limit: vi.fn(async () => ({ data: [], error: null })),
          }),
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null, count: 0 })),
          })),
        }),
      }),
    }),
  };
}

// payments query returning prior rows, com contagem coerente para a
// idempotency key derivada (checkout_{orderId}_{count}).
function priorPaymentsQuery(rows: { external_payment_id: string; status: string }[]) {
  // O mesmo builder precisa satisfazer dois usos: countPriorStripePayments
  // aguarda select().eq().eq() diretamente (thenable), e a decisao usa
  // .order().limit().
  const thenable = {
    then: (resolve: (v: { data: unknown[]; error: null; count: number }) => void) =>
      resolve({ data: [], error: null, count: rows.length }),
    order: () => ({
      limit: vi.fn(async () => ({ data: rows, error: null })),
    }),
  };
  return {
    select: () => ({
      eq: () => ({
        eq: () => thenable,
      }),
    }),
  };
}

describe("startStripeCheckout (server-side authority)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    serverClientMock.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_A } },
      error: null,
    });
    serverClientMock.from.mockImplementation(
      fromReturning({ data: makeOrderRow(USER_A), error: null }),
    );
    adminFrom.mockImplementation(() => emptyPaymentsQuery());
    providerMock.createPaymentIntent.mockResolvedValue({
      provider: "stripe",
      externalPaymentId: "cs_test_1",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    adminRpc.mockResolvedValue({ data: {}, error: null });
  });

  it("amount enviado a Stripe vem do order snapshot do DB, nao do browser", async () => {
    serverClientMock.from.mockImplementation(
      fromReturning({ data: makeOrderRow(USER_A, { total_cents: 12345, currency: "USD" }), error: null }),
    );

    await startStripeCheckout(ORDER_ID, "en");

    expect(providerMock.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 12345, currency: "USD", orderId: ORDER_ID }),
    );
  });

  it("success/cancel URLs sao construidas server-side a partir do SITE_URL", async () => {
    await startStripeCheckout(ORDER_ID, "pt");
    const input = providerMock.createPaymentIntent.mock.calls[0]![0];
    expect(input.successUrl).toBe("https://example.com/pt/account/orders/" + ORDER_ID + "?payment=success");
    expect(input.cancelUrl).toBe("https://example.com/pt/account/orders/" + ORDER_ID + "?payment=cancelled");
  });

  it("usuario A pagando pedido do usuario B: FORBIDDEN e nenhuma RPC financeira", async () => {
    serverClientMock.from.mockImplementation(
      fromReturning({ data: makeOrderRow(USER_B), error: null }),
    );

    await expect(startStripeCheckout(ORDER_ID, "en")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(adminRpc).not.toHaveBeenCalled();
    expect(providerMock.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("pedido ja pago: nao cria nova Checkout Session", async () => {
    serverClientMock.from.mockImplementation(
      fromReturning({
        data: makeOrderRow(USER_A, { paid_at: "2026-01-01T00:00:00Z" }),
        error: null,
      }),
    );

    await expect(startStripeCheckout(ORDER_ID, "en")).rejects.toMatchObject({
      code: "PAYMENT_ALREADY_COMPLETED",
    });
    expect(providerMock.createPaymentIntent).not.toHaveBeenCalled();
  });

  it("duas chamadas concorrentes do mesmo pedido usam a MESMA idempotency key", async () => {
    const [r1, r2] = await Promise.all([
      startStripeCheckout(ORDER_ID, "en"),
      startStripeCheckout(ORDER_ID, "en"),
    ]);

    const keys = providerMock.createPaymentIntent.mock.calls.map(
      (call) => call[0].idempotencyKey,
    );
    expect(new Set(keys).size).toBe(1);
    // Ambas resolvem com a mesma URL de checkout.
    expect(r1.checkoutUrl).toBe(r2.checkoutUrl);
  });

  it("record_payment_intent e chamado com o snapshot do order e o session ID", async () => {
    await startStripeCheckout(ORDER_ID, "en");

    expect(adminRpc).toHaveBeenCalledWith("record_payment_intent", {
      p_order_id: ORDER_ID,
      p_provider: "stripe",
      p_external_payment_id: "cs_test_1",
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
  });

  it("erro da RPC e mapeado para codigo interno sem vazar mensagem crua", async () => {
    adminRpc.mockResolvedValue({
      data: null,
      error: { message: '_ORDER_NOT_FOUND in rpc context with internal detail' },
    });

    await expect(startStripeCheckout(ORDER_ID, "en")).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
  });

  it("sessao open existente e reutilizada sem criar nova", async () => {
    adminFrom.mockImplementation(() => priorPaymentsQuery([{ external_payment_id: "cs_test_open", status: "pending" }]));
    providerMock.retrieveCheckoutSession.mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
    });

    const result = await startStripeCheckout(ORDER_ID, "en");
    expect(result.checkoutUrl).toContain("cs_test_open");
    expect(providerMock.createPaymentIntent).not.toHaveBeenCalled();
  });

  // TESTE CRITICO 1: webhook lag — sessao complete+paid, DB pending,
  // paid_at null. NAO criar segunda sessao cobravel.
  it("sessao complete+paid com DB pending: PAYMENT_CONFIRMATION_PENDING e nenhuma nova sessao", async () => {
    adminFrom.mockImplementation(() => priorPaymentsQuery([{ external_payment_id: "cs_1", status: "pending" }]));
    providerMock.retrieveCheckoutSession.mockResolvedValue({
      status: "complete",
      payment_status: "paid",
    });

    await expect(startStripeCheckout(ORDER_ID, "en")).rejects.toMatchObject({
      code: "PAYMENT_CONFIRMATION_PENDING",
    });
    expect(providerMock.createPaymentIntent).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  // TESTE CRITICO 2: complete+unpaid (metodo assincrono) — nao criar nova.
  it("sessao complete+unpaid com DB pending: PAYMENT_PROCESSING e nenhuma nova sessao", async () => {
    adminFrom.mockImplementation(() => priorPaymentsQuery([{ external_payment_id: "cs_1", status: "pending" }]));
    providerMock.retrieveCheckoutSession.mockResolvedValue({
      status: "complete",
      payment_status: "unpaid",
    });

    await expect(startStripeCheckout(ORDER_ID, "en")).rejects.toMatchObject({
      code: "PAYMENT_PROCESSING",
    });
    expect(providerMock.createPaymentIntent).not.toHaveBeenCalled();
  });

  // TESTE CRITICO 3: payment row failed nao bloqueia nova sessao.
  it("payment DB failed: tentativa anterior nao bloqueia; nova sessao com nova idempotency key", async () => {
    adminFrom.mockImplementation(() => priorPaymentsQuery([{ external_payment_id: "cs_1", status: "failed" }]));
    providerMock.createPaymentIntent.mockClear();

    const result = await startStripeCheckout(ORDER_ID, "en");
    expect(result.checkoutUrl).toContain("cs_test_1");
    expect(providerMock.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(providerMock.createPaymentIntent.mock.calls[0]![0].idempotencyKey).toBe(
      "checkout_" + ORDER_ID + "_1",
    );
    expect(providerMock.retrieveCheckoutSession).not.toHaveBeenCalled();
  });

  // TESTE CRITICO 4: sessao expirada permite nova sessao.
  it("sessao expirada: nova sessao criada com nova idempotency key", async () => {
    adminFrom.mockImplementation(() => priorPaymentsQuery([{ external_payment_id: "cs_1", status: "pending" }]));
    providerMock.retrieveCheckoutSession.mockResolvedValue({
      status: "expired",
      payment_status: "unpaid",
    });

    const result = await startStripeCheckout(ORDER_ID, "en");
    expect(result.checkoutUrl).toContain("cs_test_1");
    expect(providerMock.createPaymentIntent.mock.calls[0]![0].idempotencyKey).toBe(
      "checkout_" + ORDER_ID + "_1",
    );
  });
});

describe("stripe webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeStripeEvent(overrides: Record<string, unknown> = {}) {
    return {
      provider: "stripe",
      eventId: "evt_1",
      externalPaymentId: "cs_test_1",
      status: "paid",
      orderId: ORDER_ID,
      amountCents: 7500,
      currency: "BRL",
      metadata: {},
      ...overrides,
    };
  }

  function makeRequest(body: string, headers: Record<string, string> = {}) {
    return new Request("https://example.com/api/payments/stripe/webhook", {
      method: "POST",
      body,
      headers,
    });
  }

  it("evento paid valido chama confirm_order_payment com o AMOUNT DO EVENTO Stripe", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(makeStripeEvent({ amountCents: 7500 }));

    const response = await stripeWebhook(makeRequest("{}"));
    expect(response.status).toBe(200);

    expect(adminRpc).toHaveBeenCalledWith("confirm_order_payment", {
      p_order_id: ORDER_ID,
      p_provider: "stripe",
      p_external_payment_id: "cs_test_1",
      p_provider_event_id: "evt_1",
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
  });

  it("assinatura invalida retorna 400 e NAO chama confirm_order_payment", async () => {
    providerMock.parseWebhookEvent.mockRejectedValue(new MockStripeError("INVALID_SIGNATURE"));

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "bad" }));
    expect(response.status).toBe(400);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("assinatura ausente retorna 400", async () => {
    providerMock.parseWebhookEvent.mockRejectedValue(new MockStripeError("MISSING_SIGNATURE"));

    const response = await stripeWebhook(makeRequest("{}"));
    expect(response.status).toBe(400);
  });

  it("evento irrelevante retorna 200 sem tocar RPCs", async () => {
    providerMock.parseWebhookEvent.mockRejectedValue(new MockStripeError("UNSUPPORTED_EVENT"));

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(200);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("evento com amount do Stripe DIFERENTE do snapshot: RPC rejeita e 500 para retry", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(makeStripeEvent({ amountCents: 999 }));
    adminRpc.mockResolvedValue({ data: null, error: { message: "AMOUNT_MISMATCH" } });

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(500);
  });

  it("replay do mesmo evento e idempotente na RPC (200)", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(makeStripeEvent());
    adminRpc.mockResolvedValue({ data: {}, error: null });

    const first = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    const second = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(adminRpc).toHaveBeenCalledTimes(2);
  });

  it("evento sem dados financeiros completos nao confirma (200, sem RPC)", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(
      makeStripeEvent({ amountCents: undefined, currency: undefined, orderId: undefined }),
    );

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(200);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  // TESTE CRITICO 5: async_payment_failed persiste failed via RPC; nao paga.
  it("evento failed persiste record_payment_failure e NAO chama confirm_order_payment", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(
      makeStripeEvent({ status: "failed" }),
    );
    adminRpc.mockResolvedValue({ data: {}, error: null });

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(200);
    expect(adminRpc).toHaveBeenCalledWith("record_payment_failure", {
      p_order_id: ORDER_ID,
      p_provider: "stripe",
      p_external_payment_id: "cs_test_1",
      p_provider_event_id: "evt_1",
    });
    expect(adminRpc).not.toHaveBeenCalledWith("confirm_order_payment", expect.anything());
  });

  // TESTE CRITICO 6: replay do evento failed e idempotente na RPC (200).
  it("replay do evento failed e idempotente (200, sem erro)", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(
      makeStripeEvent({ status: "failed" }),
    );
    adminRpc.mockResolvedValue({ data: {}, error: null });

    const first = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    const second = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(adminRpc).toHaveBeenCalledTimes(2);
  });

  it("evento failed com erro de persistencia retorna 500 para retry", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(
      makeStripeEvent({ status: "failed" }),
    );
    adminRpc.mockResolvedValue({ data: null, error: { message: "PAYMENT_NOT_FOUND" } });

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(500);
  });

  it("evento failed sem order reference: 200 com log, sem RPC", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(
      makeStripeEvent({ status: "failed", orderId: undefined }),
    );

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(200);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("evento processing (completed unpaid) e 200 sem tocar RPCs", async () => {
    providerMock.parseWebhookEvent.mockResolvedValue(
      makeStripeEvent({ status: "processing" }),
    );

    const response = await stripeWebhook(makeRequest("{}", { "stripe-signature": "ok" }));
    expect(response.status).toBe(200);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});