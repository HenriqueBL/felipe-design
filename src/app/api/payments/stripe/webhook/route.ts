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

  // Evento irrelevante (status nao-pago): ignora sem tocar o DB financeiro.
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
    return Response.json({ received: true });
  }

  const admin = createSupabaseAdminClient();
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