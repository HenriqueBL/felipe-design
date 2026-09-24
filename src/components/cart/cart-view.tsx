"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { Cart } from "@/domain/cart";
import { clearCart, readCart, removeItem, subscribeToCart, updateQuantity } from "@/lib/cart-store";
import type { Locale } from "@/lib/i18n/config";
import { checkoutPath, servicesPath } from "@/lib/paths";
import type { Currency } from "@/types/database";

export interface CartPricingItem {
  planId: string;
  angles: number;
  priceCents: number | null;
}

export interface CartViewLabels {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  angleSingularPerKnife: string;
  anglePluralPerKnife: string;
  priceUnavailable: string;
  unitPrice: string;
  subtotal: string;
  total: string;
  totalImages: string;
  quantity: string;
  remove: string;
  clear: string;
  continueShopping: string;
  checkout: string;
  maxKnivesError: string;
}

interface CartViewProps {
  locale: Locale;
  intlLocale: string;
  currency: Currency;
  labels: CartViewLabels;
}

function formatMoney(cents: number, currency: Currency, intlLocale: string): string {
  return new Intl.NumberFormat(intlLocale, { style: "currency", currency }).format(cents / 100);
}

// Revalida precos no servidor: nada salvo no browser e autoridade.
async function fetchCartPricing(
  cart: Cart,
): Promise<Map<string, CartPricingItem>> {
  const result = new Map<string, CartPricingItem>();
  try {
    const response = await fetch("/api/cart-pricing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: cart.items, currency: cart.currency }),
    });
    if (!response.ok) {
      return result;
    }
    const data = (await response.json()) as { items: CartPricingItem[] };
    for (const item of data.items ?? []) {
      result.set(item.planId, item);
    }
  } catch {
    // Rede indisponivel: sem precos; o checkout revalida de qualquer forma.
  }
  return result;
}

export default function CartView({ locale, intlLocale, currency, labels }: CartViewProps) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [pricing, setPricing] = useState<Map<string, CartPricingItem>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [limitErrorPlanId, setLimitErrorPlanId] = useState<string | null>(null);

  const refresh = useCallback(async (current: Cart | null) => {
    setCart(current);
    if (!current) {
      setPricing(new Map());
      return;
    }
    setPricing(await fetchCartPricing(current));
  }, []);

  useEffect(() => {
    setLoaded(true);
    void refresh(readCart());
    const unsubscribe = subscribeToCart(() => {
      void refresh(readCart());
    });
    return unsubscribe;
  }, [refresh]);

  // Currency authority lives in localStorage (cart.currency). The URL-derived
  // `currency` prop is only a hint for empty-cart "continue shopping" links;
  // we never hide a populated cart because the URL lacks ?currency=.
  const activeCart = cart && cart.items.length > 0 ? cart : null;
  const displayCurrency = activeCart?.currency ?? currency;

  if (!loaded) {
    return <section aria-busy="true" />;
  }

  if (!activeCart) {
    return (
      <section className="cart-empty">
        <h1>{labels.emptyTitle}</h1>
        <p>{labels.emptyDescription}</p>
        <Link href={servicesPath(locale)} className="btn btn-primary">
          {labels.continueShopping}
        </Link>
      </section>
    );
  }

  const totalCents = activeCart.items.reduce((sum, item) => {
    const price = pricing.get(item.planId)?.priceCents;
    return price === null || price === undefined ? sum : sum + price * item.quantity;
  }, 0);
  const totalImages = activeCart.items.reduce(
    (sum, item) => sum + item.quantity * (pricing.get(item.planId)?.angles ?? 0),
    0,
  );
  const allPriced = activeCart.items.every(
    (item) => pricing.get(item.planId)?.priceCents != null,
  );

  return (
    <section className="cart-page">
      <h1>{labels.title}</h1>
      <ul className="cart-items">
        {activeCart.items.map((item) => {
          const info = pricing.get(item.planId);
          return (
            <li className="cart-item" key={item.planId}>
              <div className="cart-item-info">
                <p className="cart-item-plan">
                  {info ? info.angles : "?"}{" "}
                  {info && info.angles === 1
                    ? labels.angleSingularPerKnife
                    : labels.anglePluralPerKnife}
                </p>
                <p className="cart-item-price">
                  {info?.priceCents != null
                    ? formatMoney(info.priceCents, displayCurrency, intlLocale)
                    : labels.priceUnavailable}
                </p>
              </div>
              <div className="cart-item-actions">
                <label htmlFor={"cart-qty-" + item.planId}>{labels.quantity}</label>
                <input
                  id={"cart-qty-" + item.planId}
                  type="number"
                  min={1}
                  max={100}
                  value={item.quantity}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isFinite(parsed)) {
                      const result = updateQuantity(
                        item.planId,
                        Math.min(100, Math.max(1, Math.trunc(parsed))),
                      );
                      if (result.error === "MAX_TOTAL_KNIVES") {
                        setLimitErrorPlanId(item.planId);
                      } else {
                        setLimitErrorPlanId(null);
                      }
                    }
                  }}
                />
                <button type="button" onClick={() => removeItem(item.planId)}>
                  {labels.remove}
                </button>
              </div>
              {limitErrorPlanId === item.planId ? (
                <p className="cart-limit-error" role="alert">
                  {labels.maxKnivesError}
                </p>
              ) : null}
              {info?.priceCents != null ? (
                <p className="cart-item-subtotal">
                  {labels.subtotal}:{" "}
                  {formatMoney(info.priceCents * item.quantity, displayCurrency, intlLocale)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="cart-summary">
        <p>
          {labels.totalImages}: {totalImages}
        </p>
        <p className="cart-total">
          {labels.total}: {formatMoney(totalCents, displayCurrency, intlLocale)}
        </p>
        <div className="cart-actions">
          <Link href={servicesPath(locale)}>{labels.continueShopping}</Link>
          <button type="button" className="btn btn-secondary" onClick={() => clearCart()}>
            {labels.clear}
          </button>
          <Link
            href={checkoutPath(locale) + "?cart=1"}
            className="btn btn-primary"
            aria-disabled={!allPriced}
            onClick={(event) => {
              if (!allPriced) {
                event.preventDefault();
              }
            }}
          >
            {labels.checkout}
          </Link>
        </div>
      </div>
    </section>
  );
}