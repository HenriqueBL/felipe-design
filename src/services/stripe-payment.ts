import "server-only";

import Stripe from "stripe";
import type {
  CreatePaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  ProviderWebhookEvent,
  WebhookPaymentStatus,
} from "./payment-providers";
import type { Currency } from "@/types/database";

export const STRIPE_PROVIDER_ID = "stripe" as const;

// Eventos de Checkout one-time tratados; demais eventos sao ignorados (200).
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
] as const);

export type StripeEventCategory = "invalid_signature" | "unsupported" | "unhandled";

export class StripePaymentError extends Error {
  readonly code: string;
  readonly httpStatus?: number;

  constructor(code: string, httpStatus?: number) {
    super("Stripe payment error: " + code);
    this.name = "StripePaymentError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface StripePaymentProviderDeps {
  stripe: Pick<Stripe, "checkout" | "webhooks">;
  secretKey: string;
  webhookSecret: string;
}

function toStripeCurrency(currency: Currency): string {
  return currency.toLowerCase();
}

function toInternalCurrency(currency: string): Currency | null {
  const normalized = currency.toLowerCase();
  if (normalized === "brl") {
    return "BRL";
  }
  if (normalized === "usd") {
    return "USD";
  }
  return null;
}

// Fornecedor real via Stripe Checkout hospedado. Server-only: segredos nunca
// alcancam Client Components. O Stripe client e injetavel para testes.
export class StripePaymentProvider implements PaymentProvider {
  readonly id = STRIPE_PROVIDER_ID;
  private readonly stripe: StripePaymentProviderDeps["stripe"];
  private readonly webhookSecret: string;

  constructor(deps: StripePaymentProviderDeps) {
    this.stripe = deps.stripe;
    this.webhookSecret = deps.webhookSecret;
  }

  /**
   * Cria (ou recupera via idempotency) uma Checkout Session de pagamento
   * unico. Preco vem SEMPRE do input server-side (snapshot do pedido);
   * quantity=1 porque amountCents ja e o total autoritativo.
   */
  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    if (input.amountCents <= 0) {
      throw new StripePaymentError("INVALID_AMOUNT");
    }

    try {
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: toStripeCurrency(input.currency),
                unit_amount: input.amountCents,
                product_data: {
                  name: "Order " + input.orderId.slice(0, 8).toUpperCase(),
                },
              },
            },
          ],
          client_reference_id: input.orderId,
          metadata: { order_id: input.orderId },
          payment_intent_data: { metadata: { order_id: input.orderId } },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        },
        {
          idempotencyKey:
            input.idempotencyKey ?? this.idempotencyKeyFor(input.orderId),
        },
      );

      if (!session.url) {
        throw new StripePaymentError("CHECKOUT_URL_MISSING");
      }

      return {
        provider: this.id,
        externalPaymentId: session.id,
        checkoutUrl: session.url,
      };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  /**
   * Chave deterministica por pedido+metodo: cliques repetidos comparam na
   * mesma chave e recuperam a mesma sessao em vez de criar cobrancas novas.
   */
  idempotencyKeyFor(orderId: string): string {
    return "checkout_" + orderId;
  }

  async parseWebhookEvent(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProviderWebhookEvent> {
    const signature = headers["stripe-signature"];
    if (!signature) {
      throw new StripePaymentError("MISSING_SIGNATURE", 400);
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch {
      throw new StripePaymentError("INVALID_SIGNATURE", 400);
    }

    if (!HANDLED_EVENT_TYPES.has(event.type as (typeof HANDLED_EVENT_TYPES extends Set<infer T> ? T : never))) {
      throw new StripePaymentError("UNSUPPORTED_EVENT");
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const parsed = mapCheckoutSession(event.id, event.type, session);
    if (parsed) {
      return parsed;
    }
    throw new StripePaymentError("UNSUPPORTED_EVENT");
  }

  /** Recupera uma Checkout Session existente (status/URL para reuso). */
  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    try {
      return await this.stripe.checkout.sessions.retrieve(sessionId);
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}

function mapStripeError(error: unknown): StripePaymentError {
  if (error instanceof StripePaymentError) {
    return error;
  }
  if (error instanceof Stripe.errors.StripeError) {
    if (error.type === "StripeAuthenticationError" || error.type === "StripeInvalidRequestError") {
      return new StripePaymentError("CONFIGURATION");
    }
    return new StripePaymentError("PROVIDER_UNAVAILABLE");
  }
  return new StripePaymentError("UNKNOWN");
}

// Mapeia um checkout.session.* validado para o evento normalizado.
// So permite status "paid" quando o evento + payment_status provam pagamento.
function mapCheckoutSession(
  eventId: string,
  eventType: string,
  session: Stripe.Checkout.Session,
): ProviderWebhookEvent | null {
  const externalPaymentId = session.id;
  if (typeof externalPaymentId !== "string" || externalPaymentId.length === 0) {
    return null;
  }

  const clientRef =
    typeof session.client_reference_id === "string" ? session.client_reference_id : null;
  const metadataOrderId =
    typeof session.metadata?.order_id === "string" ? session.metadata.order_id : null;

  // Reconciliacao: ambos presentes e divergentes => rejeita processamento.
  if (clientRef && metadataOrderId && clientRef !== metadataOrderId) {
    return {
      provider: STRIPE_PROVIDER_ID,
      eventId,
      externalPaymentId,
      status: "failed",
      metadata: { mismatch: "order_reference" },
    };
  }
  const orderId = clientRef ?? metadataOrderId;

  const amountCents = session.amount_total ?? null;
  const currency = session.currency ? toInternalCurrency(session.currency) : null;

  let status: WebhookPaymentStatus;
  switch (eventType) {
    case "checkout.session.completed":
      status = session.payment_status === "paid" ? "paid" : "processing";
      break;
    case "checkout.session.async_payment_succeeded":
      status = "paid";
      break;
    case "checkout.session.async_payment_failed":
      status = "failed";
      break;
    case "checkout.session.expired":
      status = "failed";
      break;
    default:
      return null;
  }

  return {
    provider: STRIPE_PROVIDER_ID,
    eventId,
    externalPaymentId,
    status,
    amountCents: amountCents === null ? undefined : amountCents,
    currency: currency ?? undefined,
    orderId: orderId ?? undefined,
    metadata: {
      payment_status: session.payment_status,
    },
  };
}

// Provider construido sob demanda a partir da configuracao server-side
// (Supabase Vault via getStripeRuntimeConfiguration). Inicializacao lazy:
// o app inicia normalmente com Stripe NOT CONFIGURED; o erro so ocorre
// quando a funcionalidade roda. Sem singleton permanente: uma configuracao
// salva pelo Admin passa a valer sem restart (cache curto no modulo de
// configuracao, invalidado no update).
export async function getStripePaymentProvider(): Promise<StripePaymentProvider> {
  // Dynamic import: mantem o modulo da classe desacoplado do cliente
  // Supabase (testes unitarios do provider nao dependem de storage).
  const { getStripeRuntimeConfiguration } = await import("./stripe-config");
  const config = await getStripeRuntimeConfiguration();
  if (!config) {
    throw new StripePaymentError("CONFIGURATION");
  }
  const stripe = new Stripe(config.secretKey);
  return new StripePaymentProvider({
    stripe,
    secretKey: config.secretKey,
    webhookSecret: config.webhookSecret,
  });
}

export function resetStripePaymentProviderCacheForTests(): void {
  void import("./stripe-config").then((m) => m.resetStripeRuntimeCacheForTests());
}