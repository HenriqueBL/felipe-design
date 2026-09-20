"use client";

import Link from "next/link";
import { useState } from "react";

import { addToCart } from "@/lib/cart-store";
import type { Locale } from "@/lib/i18n/config";
import { cartPath } from "@/lib/paths";
import type { Currency } from "@/types/database";

interface PlanSelectorLabels {
  quantityLabel: string;
  addToCart: string;
  addedToCart: string;
  viewCart: string;
  unavailable: string;
}

interface PlanSelectorProps {
  locale: Locale;
  planId: string;
  currency: Currency;
  priceAvailable: boolean;
  labels: PlanSelectorLabels;
}

export default function PlanSelector({
  locale,
  planId,
  currency,
  priceAvailable,
  labels,
}: PlanSelectorProps) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  function handleQuantity(value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      setQuantity(Math.min(100, Math.max(1, Math.trunc(parsed))));
    }
  }

  // O carrinho guarda apenas intenção (planId/quantity/currency); o servidor
  // revalida planos e precos no checkout. Nenhum preco vem do browser.
  function handleAddToCart() {
    addToCart(planId, quantity, currency);
    setAdded(true);
  }

  return (
    <div className="plan-selector">
      <label htmlFor={"qty-" + planId}>{labels.quantityLabel}</label>
      <div className="quantity-row">
        <input
          id={"qty-" + planId}
          type="number"
          min={1}
          max={100}
          value={quantity}
          onChange={(event) => handleQuantity(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleAddToCart}
          disabled={!priceAvailable}
        >
          {priceAvailable ? labels.addToCart : labels.unavailable}
        </button>
      </div>
      {added ? (
        <p className="plan-added-note">
          {labels.addedToCart} <Link href={cartPath(locale)}>{labels.viewCart}</Link>
        </p>
      ) : null}
    </div>
  );
}