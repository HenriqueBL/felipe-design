import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Cobertura server-side de ownership do simulateMockPayment.
//
// Nota de escopo: o Server Action em si exige contexto de request do Next.js
// (cookies de sessao); a autorizacao/ownership efetivamente acontece no
// servico simulateMockPayment, que e o alvo deste teste. O Server Action e um
// thin wrapper que apenas repassa o orderId.
// =============================================================================

const { adminRpc, serverClientMock } = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  serverClientMock: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    rpc: adminRpc,
  })),
  createSupabaseServerClient: vi.fn(async () => serverClientMock),
}));

import { MockPaymentFlowError, simulateMockPayment } from "@/services/mock-payment-flow";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeOrderRow(userId: string) {
  return {
    id: ORDER_ID,
    user_id: userId,
    total_cents: 7500,
    currency: "BRL",
    paid_at: null,
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

describe("simulateMockPayment ownership (server-side)", () => {
  const previousMock = process.env.ENABLE_MOCK_PAYMENTS;

  beforeEach(() => {
    process.env.ENABLE_MOCK_PAYMENTS = "true";
    adminRpc.mockReset();
    serverClientMock.auth.getUser.mockReset();
    serverClientMock.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_A } },
      error: null,
    });
    serverClientMock.from.mockReset();
    // RLS-like: o usuario A nao ve pedidos de outros usuarios; para este
    // teste o pedido existe e pertence ao usuario B.
    serverClientMock.from.mockImplementation(
      fromReturning({ data: makeOrderRow(USER_B), error: null }),
    );
  });

  afterEach(() => {
    if (previousMock === undefined) {
      delete process.env.ENABLE_MOCK_PAYMENTS;
    } else {
      process.env.ENABLE_MOCK_PAYMENTS = previousMock;
    }
  });

  it("usuario A tentando pagar orderId do usuario B recebe FORBIDDEN e o admin client nunca executa RPCs", async () => {
    const promise = simulateMockPayment(ORDER_ID);
    await expect(promise).rejects.toBeInstanceOf(MockPaymentFlowError);
    await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A barreira de ownership acontece ANTES do uso do service role: nenhuma
    // RPC financeira (record_payment_intent / confirm_order_payment) e chamada.
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("pedido inexistente para o usuario autenticado recebe ORDER_NOT_FOUND sem RPCs", async () => {
    serverClientMock.from.mockImplementation(
      fromReturning({ data: null, error: null }),
    );

    await expect(simulateMockPayment(ORDER_ID)).rejects.toMatchObject({
      code: "ORDER_NOT_FOUND",
    });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("pedido ja pago do proprio usuario retorna sem novas RPCs financeiras", async () => {
    serverClientMock.from.mockImplementation(
      fromReturning({ data: { ...makeOrderRow(USER_A), paid_at: "2026-01-01T00:00:00Z" }, error: null }),
    );

    const order = await simulateMockPayment(ORDER_ID);
    expect(order.paid_at).not.toBeNull();
    expect(adminRpc).not.toHaveBeenCalled();
  });
});