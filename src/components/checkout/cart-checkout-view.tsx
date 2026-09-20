"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { CreateOrderResult } from "@/app/[locale]/checkout/actions";
import type { Cart } from "@/domain/cart";
import { clearCart, readCart, subscribeToCart } from "@/lib/cart-store";
import type { Locale } from "@/lib/i18n/config";
import { cartPath, servicesPath } from "@/lib/paths";
import type { Currency } from "@/types/database";

import CreateCartOrderForm from "./create-cart-order-form";

export interface CartPricingItem {
  planId: string;
  angles: number;
  priceCents: number | null;
}

interface CartCheckoutLabels {
  title: string;
  cartItemsTitle: string;
  invalidCart: string;
  anglesLabel: string;
  knivesLabel: string;
  imagesLabel: string;
  unitPrice: string;
  subtotal: string;
  total: string;
  totalImages: string;
  estimatedTurnaround: string;
  businessDaysAfterReady: string;
  backlogNote: string;
  deadlineNote: string;
  estimateUnavailable: string;
  signedInAs: string;
  loginRequired: string;
  emailLabel: string;
  emailPlaceholder: string;
  sendMagicLink: string;
  magicLinkSent: string;
  magicLinkRateLimited: string;
  error: string;
  backToServices: string;
  backToCart: string;
  createCartOrder: string;
  creatingCartOrder: string;
  invalidSelection: string;
  planUnavailable: string;
  priceUnavailable: string;
}

interface CartCheckoutViewProps {
  locale: Locale;
  intlLocale: string;
  user: { email: string } | null;
  labels: CartCheckoutLabels;
}

function formatMoney(cents: number, currency: Currency, intlLocale: string): string {
  return new Intl.NumberFormat(intlLocale, { style: "currency", currency }).format(cents / 100);
}

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
    // Rede indisponivel: sem precos; o RPC revalida de qualquer forma.
  }
  return result;
}

export default function CartCheckoutView({
  locale,
  intlLocale,
  user,
  labels,
}: CartCheckoutViewProps) {
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  const [pricing, setPricing] = useState<Map<string, CartPricingItem>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");

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

  // Gera chave de idempotencia apenas uma vez por sessao de checkout;
  // evita recriar pedido em cada render ou submit duplicado.
  useEffect(() => {
    if (!idempotencyKey && typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [idempotencyKey]);

  if (!loaded) {
    return <main className="checkout-wrap" aria-busy="true" />;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main className="checkout-wrap">
        <h1>{labels.title}</h1>
        <p className="state-note">{labels.invalidCart}</p>
        <Link href={servicesPath(locale)} className="back-link">
          {labels.backToServices}
        </Link>
      </main>
    );
  }

  const totalCents = cart.items.reduce((sum, item) => {
    const price = pricing.get(item.planId)?.priceCents;
    return price == null ? sum : sum + price * item.quantity;
  }, 0);
  const totalImages = cart.items.reduce(
    (sum, item) => sum + item.quantity * (pricing.get(item.planId)?.angles ?? 0),
    0,
  );
  const allPriced = cart.items.every(
    (item) => pricing.get(item.planId)?.priceCents != null,
  );

  return (
    <main className="checkout-wrap">
      <h1>{labels.title}</h1>
      <div className="checkout-grid">
        <section className="summary-panel">
          <h2>{labels.cartItemsTitle}</h2>
          <ul className="cart-items">
            {cart.items.map((item) => {
              const info = pricing.get(item.planId);
              return (
                <li className="cart-item" key={item.planId}>
                  <div className="row">
                    <span>{labels.anglesLabel}</span>
                    <span>{info ? info.angles : "?"}</span>
                  </div>
                  <div className="row">
                    <span>{labels.knivesLabel}</span>
                    <span>{item.quantity}</span>
                  </div>
                  <div className="row">
                    <span>{labels.imagesLabel}</span>
                    <span>{item.quantity * (info?.angles ?? 0)}</span>
                  </div>
                  <div className="row">
                    <span>{labels.unitPrice}</span>
                    <span>
                      {info?.priceCents != null
                        ? formatMoney(info.priceCents, cart.currency, intlLocale)
                        : labels.priceUnavailable}
                    </span>
                  </div>
                  {info?.priceCents != null ? (
                    <div className="row">
                      <span>{labels.subtotal}</span>
                      <span>
                        {formatMoney(info.priceCents * item.quantity, cart.currency, intlLocale)}
                      </span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="summary-rows">
            <div className="row">
              <span>{labels.totalImages}</span>
              <span>{totalImages}</span>
            </div>
            <div className="row total">
              <span>{labels.total}</span>
              <span>{formatMoney(totalCents, cart.currency, intlLocale)}</span>
            </div>
          </div>
        </section>

        <section className="auth-panel">
          {user ? (
            <div>
              <p className="note">
                {labels.signedInAs} {user.email}
              </p>
              {allPriced && idempotencyKey ? (
                <CreateCartOrderForm
                  locale={locale}
                  labels={{
                    createCartOrder: labels.createCartOrder,
                    creatingCartOrder: labels.creatingCartOrder,
                    invalidSelection: labels.invalidSelection,
                    loginRequired: labels.loginRequired,
                    planUnavailable: labels.planUnavailable,
                    error: labels.error,
                  }}
                  items={cart.items.map((item) => ({
                    planId: item.planId,
                    quantity: item.quantity,
                  }))}
                  currency={cart.currency}
                  idempotencyKey={idempotencyKey}
                  onSuccess={(result) => {
                    clearCart();
                    if (result.redirectUrl) {
                      router.push(result.redirectUrl);
                    }
                  }}
                />
              ) : (
                <p className="form-status err">{labels.priceUnavailable}</p>
              )}
            </div>
          ) : (
            <div>
              <p className="note">{labels.loginRequired}</p>
              <Link href={"/" + locale + "/login?next=" + encodeURIComponent("/" + locale + "/checkout?cart=1")} className="btn btn-primary">
                {labels.sendMagicLink}
              </Link>
            </div>
          )}
        </section>
      </div>
      <div className="back-links">
        <Link href={cartPath(locale)} className="back-link">
          {labels.backToCart}
        </Link>
        <Link href={servicesPath(locale)} className="back-link">
          {labels.backToServices}
        </Link>
      </div>
    </main>
  );
}