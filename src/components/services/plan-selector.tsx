"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buildCheckoutPath, type CheckoutParams } from "@/domain/checkout";
import type { Locale } from "@/lib/i18n/config";
import type { Currency } from "@/types/database";

interface PlanSelectorLabels {
  quantityLabel: string;
  choose: string;
  unavailable: string;
}

interface PlanSelectorProps {
  locale: Locale;
  planId: string;
  currency: Currency;
  priceAvailable: boolean;
  labels: PlanSelectorLabels;
}

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}

export default function PlanSelector({
  locale,
  planId,
  currency,
  priceAvailable,
  labels,
}: PlanSelectorProps) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);

  function handleQuantity(value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      setQuantity(Math.min(100, Math.max(1, Math.trunc(parsed))));
    }
  }

  function handleChoose() {
    const params: CheckoutParams = { planId, quantity, currency, idempotencyKey: uuidV4() };
    router.push(buildCheckoutPath(locale, params));
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
          onClick={handleChoose}
          disabled={!priceAvailable}
        >
          {priceAvailable ? labels.choose : labels.unavailable}
        </button>
      </div>
    </div>
  );
}
