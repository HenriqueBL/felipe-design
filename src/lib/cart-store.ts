"use client";

import {
  CART_MAX_TOTAL_KNIVES,
  CART_STORAGE_KEY,
  type Cart,
  type CartItem,
  cartTotalKnives,
  normalizeCart,
} from "@/domain/cart";

const CART_EVENT = "felipe-cart-change";

export function readCart(): Cart | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeCart(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCart(cart: Cart | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (cart) {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } else {
    window.localStorage.removeItem(CART_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(CART_EVENT));
}

// O carrinho guarda apenas intenção (planId, quantity). Moeda é
// server-authoritative e nunca persistida como autoridade. Legacy carts
// com campo currency são lidos mas o valor é ignorado para display/pricing.
// Aggregate knife limit is enforced HERE (not in normalizeCart) so that
// exceeding the cap rejects the operation deterministically instead of
// silently mutating unrelated items.
export function addToCart(
  planId: string,
  quantity: number,
): CartMutationResult {
  const current = readCart() ?? { items: [] };
  const baseItems = current.items;
  // Merge with existing same-plan entry first (normalizeCart deduplicates later,
  // but we need accurate total for the guard before writing anything).
  const merged = new Map<string, number>();
  for (const item of baseItems) {
    merged.set(item.planId, item.quantity);
  }
  merged.set(planId, (merged.get(planId) ?? 0) + quantity);
  const candidateItems = [...merged.entries()].map(([pid, qty]) => ({
    planId: pid,
    quantity: qty,
  }));
  if (cartTotalKnives(candidateItems) > CART_MAX_TOTAL_KNIVES) {
    // Reject: do NOT mutate cart, do NOT redistribute other items.
    return {
      cart: current.items.length > 0 ? current : null,
      error: "MAX_TOTAL_KNIVES",
    };
  }
  const cart: Cart = { items: candidateItems };
  const normalized = normalizeCart(cart);
  writeCart(normalized);
  return { cart: normalized, error: null };
}

export function updateQuantity(
  planId: string,
  quantity: number,
): CartMutationResult {
  const current = readCart();
  if (!current) {
    return { cart: null, error: null };
  }
  const candidateItems = current.items.map((item) =>
    item.planId === planId ? { planId, quantity } : item,
  );
  if (cartTotalKnives(candidateItems) > CART_MAX_TOTAL_KNIVES) {
    // Reject: preserve previous state exactly.
    return { cart: current, error: "MAX_TOTAL_KNIVES" };
  }
  const cart: Cart = { items: candidateItems };
  const normalized = normalizeCart(cart);
  writeCart(normalized);
  return { cart: normalized, error: null };
}

export function removeItem(planId: string): Cart | null {
  const current = readCart();
  if (!current) {
    return null;
  }
  const items = current.items.filter((item) => item.planId !== planId);
  const cart: Cart | null = items.length > 0 ? { items } : null;
  writeCart(cart);
  return cart;
}

export function clearCart(): void {
  writeCart(null);
}

// Currency is server-authoritative. Legacy carts may carry a currency field
// from before geo-lock; we preserve items but never use the stored currency
// for display or pricing. This function exists for backward compatibility
// during migration — it no longer clears the cart on mismatch.
export function reconcileCartCurrency(_currency: string): Cart | null {
  return readCart();
}

export function subscribeToCart(listener: () => void): () => void {
  window.addEventListener(CART_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CART_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export type CartMutationError = "MAX_TOTAL_KNIVES";

export type CartMutationResult = {
  cart: Cart | null;
  error: CartMutationError | null;
};

export type { Cart, CartItem };