import { z } from "zod";

export const orderPricingInputSchema = z.object({
  unitPriceCents: z.number().int().positive(),
  knifeQuantity: z.number().int().min(1).max(100),
  imagesPerKnife: z.number().int().min(1).max(3),
});

export type OrderPricingInput = z.infer<typeof orderPricingInputSchema>;

export interface OrderPricingResult {
  totalImages: number;
  unitPriceCents: number;
  subtotalCents: number;
  totalCents: number;
}

export function computeOrderPricing(input: OrderPricingInput): OrderPricingResult {
  const parsed = orderPricingInputSchema.parse(input);
  const totalImages = parsed.knifeQuantity * parsed.imagesPerKnife;
  const subtotalCents = parsed.unitPriceCents * parsed.knifeQuantity;
  return {
    totalImages,
    unitPriceCents: parsed.unitPriceCents,
    subtotalCents,
    totalCents: subtotalCents,
  };
}
