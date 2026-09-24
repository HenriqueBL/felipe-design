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
  maxKnivesError: string;
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
  const [limitError, setLimitError] = useState(false);

  function handleQuantity(value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      setQuantity(Math.min(100, Math.max(1, Math.trunc(parsed))));
    }
  }

  // O carrinho guarda apenas intenção (planId/quantity); moeda e preços são
  // server-authoritative. Nenhum valor monetário vem do browser.
  function handleAddToCart() {
    const result = addToCart(planId, quantity);
    if (result.error === "MAX_TOTAL_KNIVES") {
      setAdded(false);
      setLimitError(true);
      return;
    }
    setAdded(true);
    setLimitError(false);
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
      {limitError ? (
        <p className="plan-limit-error" role="alert">
          {labels.maxKnivesError}
        </p>
      ) : null}
    </div>
  );
}