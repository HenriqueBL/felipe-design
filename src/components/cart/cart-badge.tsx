"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readCart, subscribeToCart } from "@/lib/cart-store";
import type { Locale } from "@/lib/i18n/config";
import { cartPath } from "@/lib/paths";

interface CartBadgeProps {
  locale: Locale;
  label: string;
}

// Contador de facas (não de linhas): 2 linhas de 1 faca = 2 facas.
export default function CartBadge({ locale, label }: CartBadgeProps) {
  const [knives, setKnives] = useState<number | null>(null);

  useEffect(() => {
    function refresh() {
      const cart = readCart();
      setKnives(cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0);
    }
    refresh();
    const unsubscribe = subscribeToCart(refresh);
    return unsubscribe;
  }, []);

  return (
    <Link href={cartPath(locale)} className="cart-badge" aria-label={label}>
      {label}
      {knives !== null && knives > 0 ? (
        <span className="cart-badge-count">{knives}</span>
      ) : null}
    </Link>
  );
}