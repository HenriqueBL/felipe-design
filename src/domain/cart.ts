import { z } from "zod";

import type { Currency } from "@/types/database";

export const CART_STORAGE_KEY = "felipe-cart-v1";
export const CART_MAX_ITEMS = 20;
export const CART_MAX_QUANTITY_PER_PLAN = 100;

export const cartItemSchema = z.object({
  planId: z.string().uuid(),
  quantity: z.number().int().min(1).max(CART_MAX_QUANTITY_PER_PLAN),
});

export type CartItem = z.infer<typeof cartItemSchema>;

export type Cart = {
  currency: Currency;
  items: CartItem[];
};

const rawCartSchema = z.object({
  currency: z.enum(["BRL", "USD"]),
  items: z.array(z.unknown()).default([]),
});

// The cart holds INTENT only: planId + quantity per line, plus one currency.
// Prices/totals are never stored here — the server is the sole authority.
export function normalizeCart(raw: unknown): Cart | null {
  const parsed = rawCartSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  const quantities = new Map<string, number>();
  for (const entry of parsed.data.items) {
    const item = cartItemSchema.safeParse(entry);
    if (!item.success) {
      continue;
    }
    const existing = quantities.get(item.data.planId) ?? 0;
    quantities.set(
      item.data.planId,
      Math.min(existing + item.data.quantity, CART_MAX_QUANTITY_PER_PLAN),
    );
  }

  const items = [...quantities.entries()]
    .map(([planId, quantity]) => ({ planId, quantity }))
    .slice(0, CART_MAX_ITEMS);
  if (items.length === 0) {
    return null;
  }
  return { currency: parsed.data.currency, items };
}

export function cartOutputImages(
  cart: Cart,
  anglesByPlanId: Readonly<Record<string, number>>,
): number {
  return cart.items.reduce(
    (sum, item) => sum + item.quantity * (anglesByPlanId[item.planId] ?? 0),
    0,
  );
}