import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  StripePaymentError,
  getStripePaymentProvider,
} from "@/services/stripe-payment";

// Webhook publico do Stripe: autenticacao exclusivamente pela assinatura
// (Stripe-Signature + STRIPE_WEBHOOK_SECRET). O raw body e lido UMA vez,
// antes de qualquer parse. Somente POST; sem auth cookie.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  let provider;
  try {
    provider = getStripePaymentProvider();
  } catch (error) {
    if (error instanceof StripePaymentError) {
      // Configuracao ausente no servidor: nunca expoe o secret.
      console.error("[stripe-webhook] configuration error");
      return new Response("Service Unavailable", { status: 503 });
    }
    throw error;
  }

  const headers: Record<string, string> = {};
  const signature = request.headers.get("stripe-signature");
  if (signature) {
    headers["stripe-signature"] = signature;
  }

  let event;
  try {
    event = await provider.parseWebhookEvent(rawBody, headers);
  } catch (error) {
    if (error instanceof StripePaymentError) {
      if (error.code === "MISSING_SIGNATURE" || error.code === "INVALID_SIGNATURE") {
        return new Response("Bad Request", { status: 400 });
      }
      if (error.code === "UNSUPPORTED_EVENT") {
        // Evento nao tratado: 200 para o Stripe nao reenviar.
        return Response.json({ received: true });
      }
      return new Response("Bad Request", { status: 400 });
    }
    // Falha temporaria: 5xx para o Stripe tentar novamente.
    console.error("[stripe-webhook] unexpected parse failure");
    return new Response("Internal Server Error", { status: 500 });
  }

  const admin = createSupabaseAdminClient();

  // Evento de falha terminal (async_payment_failed / expired): persiste via
  // RPC autoritativa; replay e idempotente no DB. Nunca toca orders.paid_at.
  if (event.status === "failed") {
    if (event.orderId && event.externalPaymentId) {
      const { error: failureError } = await admin.rpc("record_payment_failure", {
        p_order_id: event.orderId,
        p_provider: event.provider,
        p_external_payment_id: event.externalPaymentId,
        p_provider_event_id: event.eventId,
      });
      if (failureError) {
        // Falha ao persistir: 5xx para o Stripe reenviar (estado terminal
        // pendente de persistencia e mais seguro que descartar).
        console.error("[stripe-webhook] failure persistence rejected", {
          provider: "stripe",
          eventId: event.eventId,
        });
        return new Response("Internal Server Error", { status: 500 });
      }
    } else {
      // Falha sem referencia ao pedido: anomalia logada sem dados sensiveis.
      console.error("[stripe-webhook] failed event missing order reference", {
        provider: "stripe",
        eventId: event.eventId,
      });
    }
    return Response.json({ received: true });
  }

  // Evento irrelevante (ex: completed unpaid, ainda processando): 200 sem
  // tocar o DB financeiro.
  if (event.status !== "paid") {
    return Response.json({ received: true });
  }

  // Confirmacao exige dados financeiros reportados pelo Stripe no evento.
  if (
    !event.orderId ||
    !event.externalPaymentId ||
    typeof event.amountCents !== "number" ||
    event.amountCents <= 0 ||
    !event.currency
  ) {
    // Sessao criada pelo nosso sistema com evento paid sem dados financeiros
    // e anomalia: log estruturado sem secrets/payload bruto; nao confirma.
    // 200 (nao 5xx): reenvios nao mudariam o payload; descarta com rastreio.
    console.error("[stripe-webhook] paid event missing financial data", {
      provider: "stripe",
      eventId: event.eventId,
      hasOrderId: Boolean(event.orderId),
      hasAmount: typeof event.amountCents === "number",
      hasCurrency: Boolean(event.currency),
    });
    return Response.json({ received: true });
  }

  const { error } = await admin.rpc("confirm_order_payment", {
    p_order_id: event.orderId,
    p_provider: event.provider,
    p_external_payment_id: event.externalPaymentId,
    p_provider_event_id: event.eventId,
    p_amount_cents: event.amountCents,
    p_currency: event.currency,
  });

  if (error) {
    // Replay idempotente com payload identico termina com sucesso na RPC;
    // PAYMENT_EVENT_MISMATCH indica replay divergente ou dados invalidos:
    // ambos logados sem detalhes sensiveis e sem vazar erro cru ao cliente.
    console.error("[stripe-webhook] confirmation rejected", {
      provider: "stripe",
      eventId: event.eventId,
    });
    return new Response("Internal Server Error", { status: 500 });
  }

  // Revalidacao e best-effort: falha aqui nunca desfaz pagamento valido.
  revalidatePath("/en/account/orders/" + event.orderId);
  revalidatePath("/pt/account/orders/" + event.orderId);
  revalidatePath("/en/account");
  revalidatePath("/pt/account");

  return Response.json({ received: true });
}