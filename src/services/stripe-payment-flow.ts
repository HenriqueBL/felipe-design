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

// Decisao sobre uma tentativa de checkout anterior: nunca criar uma nova
// Checkout Session enquanto uma tentativa anterior puder ser cobrada.
// - reuse: sessao open => devolver a MESMA URL
// - confirmation_pending: complete + paid => pago na Stripe, DB ainda
//   confirmando (webhook lag)
// - payment_processing: complete + unpaid com pagamento DB pendente
// - retry_allowed: expirado/inacessivel
// - none: sem tentativas anteriores
// - failed: pagamento DB terminou como failed
type ExistingCheckoutDecision =
  | { kind: "reuse"; checkoutUrl: string }
  | { kind: "confirmation_pending" }
  | { kind: "payment_processing" }
  | { kind: "retry_allowed" }
  | { kind: "none" };

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

  // Reuso/bloqueio de sessao: consulta pagamentos Stripe anteriores e o
  // estado real da Checkout Session na Stripe. Nunca cria nova cobranca
  // enquanto uma tentativa anterior for cobravel (open) ou o pagamento
  // estiver em confirmacao/processamento.
  const decision = await decideExistingCheckout(provider, admin, order.id);
  if (decision.kind === "reuse") {
    return { checkoutUrl: decision.checkoutUrl };
  }
  if (decision.kind === "confirmation_pending") {
    throw new StripePaymentFlowError("PAYMENT_CONFIRMATION_PENDING");
  }
  if (decision.kind === "payment_processing") {
    throw new StripePaymentFlowError("PAYMENT_PROCESSING");
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

// Decide o que fazer com as tentativas anteriores de checkout do pedido.
// Combina payments.status (DB) com o status real da Checkout Session na
// Stripe — orders.paid_at e apenas o fast path inicial, nao suficiente
// durante webhook lag.
async function decideExistingCheckout(
  provider: StripePaymentProvider,
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderId: string,
): Promise<ExistingCheckoutDecision> {
  const { data: prior, error } = await admin
    .from("payments")
    .select("external_payment_id, status")
    .eq("order_id", orderId)
    .eq("provider", "stripe")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !prior || prior.length === 0) {
    return { kind: "none" };
  }

  for (const payment of prior) {
    // paid ja deveria ter setado paid_at (fast path acima); failed e
    // terminalmente nao-pagavel: ambos nao bloqueiam nova sessao.
    if (payment.status === "paid" || payment.status === "failed") {
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
      return { kind: "reuse", checkoutUrl: session.url };
    }
    if (session.status === "complete") {
      if (session.payment_status === "paid") {
        // Pagamento ja ocorreu na Stripe; webhook pode estar atrasado.
        // Nunca criar nova cobranca nesta janela.
        return { kind: "confirmation_pending" };
      }
      // complete + unpaid: metodo assincrono possivelmente em processamento.
      // Bloqueia enquanto o pagamento DB estiver pendente/processing.
      return { kind: "payment_processing" };
    }
    // expired (ou outro estado terminal nao-pagavel): retry permitido.
  }
  return { kind: "none" };
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