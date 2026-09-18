import "server-only";

import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import {
  StripePaymentError,
  StripePaymentProvider,
  getStripePaymentProvider,
} from "@/services/stripe-payment";

export class StripePaymentFlowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Stripe payment flow failed: " + code);
    this.name = "StripePaymentFlowError";
    this.code = code;
  }
}

interface StartCheckoutResult {
  checkoutUrl: string;
}

function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) {
    throw new StripePaymentFlowError("CONFIGURATION");
  }
  return raw.replace(/\/+$/, "");
}

// Fluxo server-side para iniciar pagamento via Stripe Checkout hospedado.
// O browser envia apenas orderId e locale; valor/moeda vem exclusivamente do
// snapshot do pedido carregado via Supabase autenticado (RLS protege acesso).
export async function startStripeCheckout(
  orderId: string,
  locale: string,
): Promise<StartCheckoutResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  if (userError || !userId) {
    throw new StripePaymentFlowError("FORBIDDEN");
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    throw new StripePaymentFlowError("ORDER_NOT_FOUND");
  }
  if (order.user_id !== userId) {
    throw new StripePaymentFlowError("FORBIDDEN");
  }

  if (order.paid_at !== null) {
    throw new StripePaymentFlowError("PAYMENT_ALREADY_COMPLETED");
  }
  if (order.status === "cancelled") {
    throw new StripePaymentFlowError("ORDER_NOT_PAYABLE");
  }

  let provider: StripePaymentProvider;
  try {
    provider = getStripePaymentProvider();
  } catch (error) {
    if (error instanceof StripePaymentError) {
      throw new StripePaymentFlowError(error.code);
    }
    throw error;
  }

  const base = siteUrl() + "/" + (locale === "pt" ? "pt" : "en");
  const orderPath = "/account/orders/" + order.id;
  const successUrl = base + orderPath + "?payment=success";
  const cancelUrl = base + orderPath + "?payment=cancelled";

  const admin = createSupabaseAdminClient();

  // Reuso de sessao: se ja existe um pagamento Stripe pendente para o pedido
  // com sessao ainda open, devolve a mesma URL em vez de criar nova cobranca.
  const reusable = await findReusableOpenSession(provider, admin, order.id);
  if (reusable) {
    return { checkoutUrl: reusable };
  }

  // Apos expiry (ou sessao inacessivel), a nova tentativa precisa de uma
  // idempotency key distinta: indexada pelo numero de pagamentos anteriores
  // do mesmo pedido, deterministica sob concorrencia (o INSERT do
  // record_payment_intent serializa por FOR UPDATE na mesma ordem).
  const priorAttempts = await countPriorStripePayments(admin, order.id);

  const intent = await provider.createPaymentIntent({
    orderId: order.id,
    amountCents: order.total_cents,
    currency: order.currency,
    successUrl,
    cancelUrl,
    idempotencyKey: provider.idempotencyKeyFor(order.id) + "_" + priorAttempts,
  });

  const intentResult = await admin.rpc("record_payment_intent", {
    p_order_id: order.id,
    p_provider: intent.provider,
    p_external_payment_id: intent.externalPaymentId,
    p_amount_cents: order.total_cents,
    p_currency: order.currency,
  });

  if (intentResult.error) {
    throw new StripePaymentFlowError(toFlowErrorCode(intentResult.error.message));
  }

  return { checkoutUrl: intent.checkoutUrl };
}

async function countPriorStripePayments(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("provider", "stripe");
  if (error || count === null) {
    throw new StripePaymentFlowError("UNKNOWN");
  }
  return count;
}

async function findReusableOpenSession(
  provider: StripePaymentProvider,
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
): Promise<string | null> {
  const { data: pending, error } = await admin
    .from("payments")
    .select("external_payment_id, status")
    .eq("order_id", orderId)
    .eq("provider", "stripe")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !pending || pending.length === 0) {
    return null;
  }

  for (const payment of pending) {
    if (payment.status === "paid") {
      continue;
    }
    let session;
    try {
      session = await provider.retrieveCheckoutSession(payment.external_payment_id);
    } catch {
      // Sessao removida/inacessivel: continua; nova sessao usara a idempotency
      // key derivada do pedido, e o Stripe reconcilia por essa chave.
      continue;
    }
    if (session.status === "open" && session.url) {
      return session.url;
    }
  }
  return null;
}

function toFlowErrorCode(message: string | undefined): string {
  if (!message) {
    return "UNKNOWN";
  }
  if (message.includes("ORDER_NOT_FOUND")) {
    return "ORDER_NOT_FOUND";
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