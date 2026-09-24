import { z } from "zod";

export const CART_STORAGE_KEY = "felipe-cart-v1";
export const CART_MAX_ITEMS = 20;
export const CART_MAX_QUANTITY_PER_PLAN = 100;
export const CART_MAX_TOTAL_KNIVES = 100;

export const cartItemSchema = z.object({
  planId: z.string().uuid(),
  quantity: z.number().int().min(1).max(CART_MAX_QUANTITY_PER_PLAN),
});

export type CartItem = z.infer<typeof cartItemSchema>;

// Cart holds INTENT only: planId + quantity per line.
// Currency is server-authoritative and never stored as authority.
// Legacy carts with a currency field are accepted during parsing but
// the currency value is discarded — items are preserved.
export type Cart = {
  items: CartItem[];
};

const rawCartSchema = z.object({
  currency: z.enum(["BRL", "USD"]).optional(),
  items: z.array(z.unknown()).default([]),
});

// Pure structural normalizer: deduplicates, caps per-item quantity,
// and discards any legacy currency field. Items-only output.
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

  // normalizeCart is a PURE structural normalizer: it deduplicates and caps
  // per-item quantity only. Aggregate knife limit enforcement belongs in
  // addToCart/updateQuantity so that exceeding the cap rejects the operation
  // deterministically instead of silently mutating unrelated items.

  if (items.length === 0) {
    return null;
  }
  return { items };
}

/** Pure helper: compute total knives for a set of cart items. */
export function cartTotalKnives(items: ReadonlyArray<{ quantity: number }>): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
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