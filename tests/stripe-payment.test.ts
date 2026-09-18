import { beforeEach, describe, expect, it, vi } from "vitest";

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
  },
}));

vi.mock("server-only", () => ({}));

import {
  StripePaymentProvider,
  StripePaymentError,
} from "@/services/stripe-payment";
import type { CreatePaymentIntentInput } from "@/services/payment-providers";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";

function makeInput(overrides: Partial<CreatePaymentIntentInput> = {}): CreatePaymentIntentInput {
  return {
    orderId: ORDER_ID,
    amountCents: 7500,
    currency: "BRL",
    successUrl: "https://example.com/success",
    cancelUrl: "https://example.com/cancel",
    ...overrides,
  };
}

function makeProvider(): StripePaymentProvider {
  return new StripePaymentProvider({
    stripe: stripeMock as never,
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
  });
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    status: "complete",
    payment_status: "paid",
    client_reference_id: ORDER_ID,
    metadata: { order_id: ORDER_ID },
    amount_total: 7500,
    currency: "brl",
    ...overrides,
  };
}

function makeEvent(type: string, session: Record<string, unknown>) {
  return {
    id: "evt_test_1",
    type,
    data: { object: session },
  };
}

describe("StripePaymentProvider.createPaymentIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria sessao mode=payment com amount e currency do input server-side", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(makeSession());
    await provider.createPaymentIntent(makeInput());

    const [params, options] = stripeMock.checkout.sessions.create.mock.calls[0]!;
    expect(params.mode).toBe("payment");
    expect(params.line_items[0].price_data.unit_amount).toBe(7500);
    expect(params.line_items[0].price_data.currency).toBe("brl");
    expect(params.line_items[0].quantity).toBe(1);
    expect(options.idempotencyKey).toBe("checkout_" + ORDER_ID);
  });

  it("usa currency usd corretamente", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(makeSession());
    await provider.createPaymentIntent(makeInput({ currency: "USD" }));
    expect(stripeMock.checkout.sessions.create.mock.calls[0]![0].line_items[0].price_data.currency).toBe("usd");
  });

  it("define client_reference_id e metadata.order_id", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(makeSession());
    await provider.createPaymentIntent(makeInput());

    const [params] = stripeMock.checkout.sessions.create.mock.calls[0]!;
    expect(params.client_reference_id).toBe(ORDER_ID);
    expect(params.metadata.order_id).toBe(ORDER_ID);
    expect(params.payment_intent_data.metadata.order_id).toBe(ORDER_ID);
  });

  it("usa idempotencyKey fornecida quando presente", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(makeSession());
    await provider.createPaymentIntent(makeInput({ idempotencyKey: "checkout_x_2" }));
    expect(stripeMock.checkout.sessions.create.mock.calls[0]![1].idempotencyKey).toBe("checkout_x_2");
  });

  it("amount invalido rejeita antes de chamar a Stripe", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockClear();
    await expect(provider.createPaymentIntent(makeInput({ amountCents: 0 }))).rejects.toMatchObject({
      code: "INVALID_AMOUNT",
    });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("sessao sem URL e mapeada para erro interno seguro", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(makeSession({ url: null }));
    await expect(provider.createPaymentIntent(makeInput())).rejects.toBeInstanceOf(StripePaymentError);
  });

  it("externalPaymentId e o Checkout Session ID", async () => {
    const provider = makeProvider();
    stripeMock.checkout.sessions.create.mockResolvedValueOnce(makeSession());
    const result = await provider.createPaymentIntent(makeInput());
    expect(result.externalPaymentId).toBe("cs_test_123");
    expect(result.provider).toBe("stripe");
    expect(result.checkoutUrl).toContain("https://checkout.stripe.com");
  });
});

describe("StripePaymentProvider.parseWebhookEvent", () => {
  it("assinatura ausente lanca MISSING_SIGNATURE", async () => {
    const provider = makeProvider();
    await expect(provider.parseWebhookEvent("{}", {})).rejects.toMatchObject({
      code: "MISSING_SIGNATURE",
    });
    expect(stripeMock.webhooks.constructEvent).not.toHaveBeenCalled();
  });

  it("assinatura invalida lanca INVALID_SIGNATURE sem processar", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error("bad signature");
    });
    await expect(
      provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=bad" }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
  });

  it("evento irrelevante e rejeitado como UNSUPPORTED_EVENT", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent("payment_method.attached", {}),
    );
    await expect(
      provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_EVENT" });
  });

  it("checkout.session.completed + paid confirma paid com amount/currency do evento", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent("checkout.session.completed", makeSession()),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.status).toBe("paid");
    expect(event.amountCents).toBe(7500);
    expect(event.currency).toBe("BRL");
    expect(event.orderId).toBe(ORDER_ID);
    expect(event.externalPaymentId).toBe("cs_test_123");
    expect(event.eventId).toBe("evt_test_1");
  });

  it("checkout.session.completed + unpaid NAO marca paid", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent("checkout.session.completed", makeSession({ payment_status: "unpaid" })),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.status).not.toBe("paid");
  });

  it("async_payment_succeeded marca paid", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent("checkout.session.async_payment_succeeded", makeSession()),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.status).toBe("paid");
  });

  it("async_payment_failed e expired NAO marcam paid", async () => {
    const provider = makeProvider();
    for (const type of ["checkout.session.async_payment_failed", "checkout.session.expired"]) {
      stripeMock.webhooks.constructEvent.mockReturnValueOnce(makeEvent(type, makeSession()));
      const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
      expect(event.status).not.toBe("paid");
    }
  });

  it("currency nao suportada fica ausente no evento (webhook nao confirmara)", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent("checkout.session.completed", makeSession({ currency: "eur" })),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.currency).toBeUndefined();
  });

  it("amount ausente fica undefined no evento", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent("checkout.session.completed", makeSession({ amount_total: null })),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.amountCents).toBeUndefined();
  });

  it("divergencia entre client_reference_id e metadata.order_id e rejeitada (non-paid)", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent(
        "checkout.session.completed",
        makeSession({
          client_reference_id: "22222222-2222-2222-2222-222222222222",
          metadata: { order_id: ORDER_ID },
        }),
      ),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.status).not.toBe("paid");
    expect(event.orderId).toBeUndefined();
  });

  it("sem nenhuma referencia de pedido: orderId ausente (nao confirma)", async () => {
    const provider = makeProvider();
    stripeMock.webhooks.constructEvent.mockReturnValueOnce(
      makeEvent(
        "checkout.session.completed",
        makeSession({ client_reference_id: null, metadata: {} }),
      ),
    );
    const event = await provider.parseWebhookEvent("{}", { "stripe-signature": "t=1,v1=ok" });
    expect(event.orderId).toBeUndefined();
    expect(event.status).toBe("paid"); // status do provedor; webhook exige orderId para confirmar
  });
});