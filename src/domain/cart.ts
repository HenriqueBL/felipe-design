import { z } from "zod";

import type { Currency } from "@/types/database";

export const CART_STORAGE_KEY = "felipe-cart-v1";
export const CART_MAX_ITEMS = 20;
export const CART_MAX_QUANTITY_PER_PLAN = 100;
export const CART_MAX_TOTAL_KNIVES = 100;

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

  let rawItems = [...quantities.entries()]
    .map(([planId, quantity]) => ({ planId, quantity }))
    .slice(0, CART_MAX_ITEMS);

  // Enforce aggregate knife limit across all items. If total exceeds the cap,
  // proportionally reduce quantities (largest-first) to stay within budget.
  let totalKnives = rawItems.reduce((sum, item) => sum + item.quantity, 0);
  while (totalKnives > CART_MAX_TOTAL_KNIVES && rawItems.length > 0) {
    // Find item with largest quantity to reduce
    let maxIdx = 0;
    for (let i = 1; i < rawItems.length; i++) {
      if (rawItems[i]!.quantity > rawItems[maxIdx]!.quantity) {
        maxIdx = i;
      }
    }
    const excess = totalKnives - CART_MAX_TOTAL_KNIVES;
    const reduction = Math.min(excess, rawItems[maxIdx]!.quantity - 1);
    if (reduction <= 0) {
      // Can't reduce further without removing item; remove smallest instead
      rawItems = rawItems.filter((_, i) => i !== maxIdx);
    } else {
      rawItems[maxIdx] = {
        ...rawItems[maxIdx]!,
        quantity: rawItems[maxIdx]!.quantity - reduction,
      };
    }
    totalKnives = rawItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  if (rawItems.length === 0) {
    return null;
  }
  return { currency: parsed.data.currency, items: rawItems };
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