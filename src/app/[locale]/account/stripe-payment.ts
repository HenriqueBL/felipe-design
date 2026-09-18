"use server";

import { z } from "zod";
import { StripePaymentFlowError, startStripeCheckout } from "@/services/stripe-payment-flow";

export interface StartStripePaymentResult {
  success: boolean;
  errorCode?: string;
  checkoutUrl?: string;
}

const inputSchema = z.object({
  orderId: z.string().uuid(),
  locale: z.enum(["en", "pt"]),
});

// Pagamento real via Stripe Checkout. O cliente envia SOMENTE orderId e
// locale; valor, moeda e URL de checkout sao resolvidos no servidor.
export async function startStripePaymentAction(
  input: z.infer<typeof inputSchema>,
): Promise<StartStripePaymentResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }

  try {
    const result = await startStripeCheckout(parsed.data.orderId, parsed.data.locale);
    return { success: true, checkoutUrl: result.checkoutUrl };
  } catch (error) {
    const code = error instanceof StripePaymentFlowError ? error.code : "UNKNOWN";
    return { success: false, errorCode: code };
  }
}