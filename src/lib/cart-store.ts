"use client";

import {
  CART_STORAGE_KEY,
  type Cart,
  type CartItem,
  normalizeCart,
} from "@/domain/cart";
import type { Currency } from "@/types/database";

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

// O carrinho guarda apenas intenção (planId, quantity, currency). Preços e
// totais são sempre revalidados no servidor; nada salvo aqui é autoridade.
export function addToCart(planId: string, quantity: number, currency: Currency): Cart | null {
  const current = readCart() ?? { currency, items: [] };
  const cart: Cart = current.currency === currency
    ? { currency, items: [...current.items, { planId, quantity }] }
    : { currency, items: [{ planId, quantity }] };
  const normalized = normalizeCart(cart);
  writeCart(normalized);
  return normalized;
}

export function updateQuantity(planId: string, quantity: number): Cart | null {
  const current = readCart();
  if (!current) {
    return null;
  }
  const cart: Cart = {
    currency: current.currency,
    items: current.items.map((item) =>
      item.planId === planId ? { planId, quantity } : item,
    ),
  };
  const normalized = normalizeCart(cart);
  writeCart(normalized);
  return normalized;
}

export function removeItem(planId: string): Cart | null {
  const current = readCart();
  if (!current) {
    return null;
  }
  const items = current.items.filter((item) => item.planId !== planId);
  const cart: Cart | null = items.length > 0 ? { currency: current.currency, items } : null;
  writeCart(cart);
  return cart;
}

export function clearCart(): void {
  writeCart(null);
}

// Moeda diferente exige carrinho novo (nunca converter BRL <-> USD).
export function reconcileCartCurrency(currency: Currency): Cart | null {
  const current = readCart();
  if (!current || current.currency === currency) {
    return current;
  }
  clearCart();
  return null;
}

export function subscribeToCart(listener: () => void): () => void {
  window.addEventListener(CART_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CART_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export type { Cart, CartItem };