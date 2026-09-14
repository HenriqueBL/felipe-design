import { randomUUID } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  if (message?.includes("ORDER_NOT_FOUND")) {
    return "ORDER_NOT_FOUND";
  }
  if (message?.includes("FORBIDDEN")) {
    return "FORBIDDEN";
  }
  return "UNKNOWN";
}

// Pagamento simulado, exclusivo de desenvolvimento (ENABLE_MOCK_PAYMENTS=true).
// Reproduz o ciclo de um gateway real: intencao de pagamento -> evento de
// confirmacao (equivalente ao webhook). Valor e moeda vem sempre do snapshot
// do pedido no servidor; o browser envia apenas o orderId.
export async function simulateMockPayment(orderId: string): Promise<OrderRow> {
  if (!isMockPaymentsEnabled()) {
    throw new MockPaymentFlowError("MOCK_DISABLED");
  }

  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    throw new MockPaymentFlowError("ORDER_NOT_FOUND");
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

  // Etapa 1: registro da intencao (equivalente a criacao no gateway).
  const intentResult = await supabase.rpc("record_payment_intent", {
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
  const confirmResult = await supabase.rpc("confirm_order_payment", {
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
