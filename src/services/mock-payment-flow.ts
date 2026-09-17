import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { isMockPaymentsEnabled, MockPaymentProvider } from "@/services/mock-payment";
import type { OrderRow } from "@/types/database";

export class MockPaymentFlowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Mock payment flow failed: " + code);
    this.name = "MockPaymentFlowError";
    this.code = code;
  }
}

function toErrorCode(message: string | undefined): string {
  if (!message) {
    return "UNKNOWN";
  }
  if (message.includes("ORDER_NOT_FOUND")) {
    return "ORDER_NOT_FOUND";
  }
  if (message.includes("FORBIDDEN")) {
    return "FORBIDDEN";
  }
  if (message.includes("AMOUNT_MISMATCH")) {
    return "AMOUNT_MISMATCH";
  }
  if (message.includes("CURRENCY_MISMATCH")) {
    return "CURRENCY_MISMATCH";
  }
  if (message.includes("PAYMENT_ORDER_MISMATCH")) {
    return "PAYMENT_ORDER_MISMATCH";
  }
  if (message.includes("PAYMENT_EVENT_MISMATCH")) {
    return "PAYMENT_EVENT_MISMATCH";
  }
  return "UNKNOWN";
}

// Pagamento simulado, exclusivo de desenvolvimento (ENABLE_MOCK_PAYMENTS=true).
// Reproduz o ciclo de um gateway real: intencao de pagamento -> evento de
// confirmacao (equivalente ao webhook). Valor e moeda vem sempre do snapshot
// do pedido lido no servidor; o browser envia apenas o orderId. As RPCs de
// pagamento sao exclusivas do service_role: o server client autentica o
// usuario e confirma a propriedade do pedido antes do uso do admin client.
export async function simulateMockPayment(orderId: string): Promise<OrderRow> {
  if (!isMockPaymentsEnabled()) {
    throw new MockPaymentFlowError("MOCK_DISABLED");
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  if (userError || !userId) {
    throw new MockPaymentFlowError("FORBIDDEN");
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    throw new MockPaymentFlowError("ORDER_NOT_FOUND");
  }

  if (order.user_id !== userId) {
    throw new MockPaymentFlowError("FORBIDDEN");
  }

  // Idempotente por pedido: reconfirmar um pedido ja pago nao gera novo pagamento.
  if (order.paid_at !== null) {
    return order;
  }

  const provider = new MockPaymentProvider();
  const intent = await provider.createPaymentIntent({
    orderId,
    amountCents: order.total_cents,
    currency: order.currency,
    successUrl: "/mock",
    cancelUrl: "/mock",
  });

  const admin = createSupabaseAdminClient();

  // Etapa 1: registro da intencao (equivalente a criacao no gateway).
  const intentResult = await admin.rpc("record_payment_intent", {
    p_order_id: orderId,
    p_provider: intent.provider,
    p_external_payment_id: intent.externalPaymentId,
    p_amount_cents: order.total_cents,
    p_currency: order.currency,
  });

  if (intentResult.error) {
    throw new MockPaymentFlowError(toErrorCode(intentResult.error.message));
  }

  // Etapa 2: confirmacao via evento (equivalente ao webhook de pagamento).
  // A RPC grava paid_at, congela o prazo (nunca diminui) e registra o evento.
  const eventId = "mockevt_" + randomUUID();
  const confirmResult = await admin.rpc("confirm_order_payment", {
    p_order_id: orderId,
    p_provider: intent.provider,
    p_external_payment_id: intent.externalPaymentId,
    p_provider_event_id: eventId,
    p_amount_cents: order.total_cents,
    p_currency: order.currency,
  });

  if (confirmResult.error) {
    throw new MockPaymentFlowError(toErrorCode(confirmResult.error.message));
  }
  if (!confirmResult.data) {
    throw new MockPaymentFlowError("UNKNOWN");
  }

  return confirmResult.data;
}
