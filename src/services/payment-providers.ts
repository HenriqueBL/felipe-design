import type { Currency, PaymentProviderId } from "@/types/database";

export type WebhookPaymentStatus = "pending" | "processing" | "paid" | "failed" | "refunded";

export interface CreatePaymentIntentInput {
  orderId: string;
  amountCents: number;
  currency: Currency;
  successUrl: string;
  cancelUrl: string;
  /**
   * Chave de idempotencia do provedor para esta tentativa. Ausente = o
   * provedor decide (provider Stripe usa chave derivada do orderId).
   */
  idempotencyKey?: string;
}

export interface PaymentIntentResult {
  provider: PaymentProviderId;
  externalPaymentId: string;
  checkoutUrl: string;
}

export interface ProviderWebhookEvent {
  provider: PaymentProviderId;
  eventId: string;
  externalPaymentId: string;
  status: WebhookPaymentStatus;
  /**
   * Valor reportado pelo provedor no evento (nao do snapshot do pedido).
   * Ausente quando o evento nao carrega informacao financeira.
   */
  amountCents?: number;
  /** Moeda reportada pelo provedor, em formato interno (BRL/USD). */
  currency?: Currency;
  /** Referencia ao pedido presente no objeto do provedor. */
  orderId?: string;
  metadata: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult>;
  parseWebhookEvent(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<ProviderWebhookEvent>;
}

const registry = new Map<PaymentProviderId, PaymentProvider>();

export function registerPaymentProvider(provider: PaymentProvider): void {
  registry.set(provider.id, provider);
}

export function getPaymentProvider(providerId: PaymentProviderId): PaymentProvider | null {
  return registry.get(providerId) ?? null;
}
