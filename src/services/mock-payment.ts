import { randomUUID } from "node:crypto";
import type {
  CreatePaymentIntentInput,
  PaymentIntentResult,
  PaymentProvider,
  ProviderWebhookEvent,
} from "./payment-providers";

// Provedor de pagamento simulado: exclusivo para desenvolvimento.
// Reproduz o ciclo real dos gateways: intencao de pagamento -> confirmacao
// por evento (equivalente ao webhook). Guardado por ENABLE_MOCK_PAYMENTS.
export const MOCK_PROVIDER_ID = "mock" as const;

export class MockPaymentProvider implements PaymentProvider {
  readonly id = MOCK_PROVIDER_ID;

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    const externalPaymentId = "mock_" + input.orderId + "_" + randomUUID().slice(0, 8);
    return {
      provider: this.id,
      externalPaymentId,
      // No fluxo simulado o "checkout" do provedor e a propria pagina do pedido.
      checkoutUrl: input.successUrl,
    };
  }

  async parseWebhookEvent(rawBody: string): Promise<ProviderWebhookEvent> {
    let payload: { event_id?: string; payment_id?: string; order_id?: string };
    try {
      payload = JSON.parse(rawBody) as { event_id?: string; payment_id?: string; order_id?: string };
    } catch {
      throw new Error("Invalid mock webhook payload");
    }
    if (!payload.event_id || !payload.payment_id || !payload.order_id) {
      throw new Error("Invalid mock webhook payload");
    }
    return {
      provider: this.id,
      eventId: payload.event_id,
      externalPaymentId: payload.payment_id,
      status: "paid",
      metadata: { order_id: payload.order_id },
    };
  }
}

export function isMockPaymentsEnabled(): boolean {
  return process.env.ENABLE_MOCK_PAYMENTS === "true";
}
