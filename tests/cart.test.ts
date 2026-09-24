// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CART_MAX_ITEMS,
  CART_MAX_TOTAL_KNIVES,
  CART_STORAGE_KEY,
  cartOutputImages,
  normalizeCart,
} from "@/domain/cart";
import { addToCart, clearCart, readCart, updateQuantity } from "@/lib/cart-store";

describe("normalizeCart", () => {
  it("accepts a valid cart (legacy currency field discarded)", () => {
    const cart = normalizeCart({
      currency: "BRL",
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 2 }],
    });
    // Currency is no longer part of Cart; items are preserved.
    expect(cart).toEqual({
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 2 }],
    });
  });

  it("returns null for null/undefined/non-object", () => {
    expect(normalizeCart(null)).toBeNull();
    expect(normalizeCart(undefined)).toBeNull();
    expect(normalizeCart("cart")).toBeNull();
    expect(normalizeCart(42)).toBeNull();
  });

  it("returns null for invalid currency", () => {
    expect(
      normalizeCart({
        currency: "EUR",
        items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
      }),
    ).toBeNull();
  });

  it("drops entries with invalid planId or quantity", () => {
    const cart = normalizeCart({
      currency: "USD",
      items: [
        { planId: "not-a-uuid", quantity: 1 },
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 0 },
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", quantity: 1 },
      ],
    });
    // Currency is no longer part of Cart; items are preserved.
    expect(cart).toEqual({
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", quantity: 1 }],
    });
  });

  it("merges duplicate planIds by summing quantities", () => {
    const cart = normalizeCart({
      currency: "BRL",
      items: [
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 },
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 2 },
      ],
    });
    expect(cart?.items).toHaveLength(1);
    expect(cart?.items[0]?.quantity).toBe(3);
  });

  it("caps merged quantity at 100", () => {
    const cart = normalizeCart({
      currency: "BRL",
      items: [
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 60 },
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 60 },
      ],
    });
    expect(cart?.items[0]?.quantity).toBe(100);
  });

  it("caps the number of distinct items at the limit", () => {
    const items = Array.from({ length: CART_MAX_ITEMS + 5 }, (_, i) => ({
      planId: `b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a00${String(i).padStart(2, "0")}`,
      quantity: 1,
    }));
    const cart = normalizeCart({ currency: "BRL", items });
    expect(cart?.items.length).toBeLessThanOrEqual(CART_MAX_ITEMS);
  });

  it("returns null when no valid items remain", () => {
    expect(normalizeCart({ currency: "BRL", items: [] })).toBeNull();
    expect(
      normalizeCart({ currency: "BRL", items: [{ planId: "bad", quantity: 1 }] }),
    ).toBeNull();
  });

  it("round-trips localStorage JSON (legacy currency field discarded)", () => {
    const legacy = {
      currency: "BRL",
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
    };
    const roundTripped = normalizeCart(JSON.parse(JSON.stringify(legacy)));
    // Currency is no longer part of Cart; items are preserved.
    expect(roundTripped).toEqual({
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
    });
    expect(CART_STORAGE_KEY).toBe("felipe-cart-v1");
  });
});

describe("cartOutputImages", () => {
  it("sums quantity * angles across items", () => {
    const cart = {
      currency: "BRL" as const,
      items: [
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 },
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", quantity: 1 },
      ],
    };
    expect(
      cartOutputImages(cart, {
        "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001": 3,
        "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002": 1,
      }),
    ).toBe(4);
  });

  it("treats unknown plans as zero angles", () => {
    const cart = {
      currency: "BRL" as const,
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 2 }],
    };
    expect(cartOutputImages(cart, {})).toBe(0);
  });
});

describe("CartMutationResult — addToCart / updateQuantity", () => {
  beforeEach(() => {
    clearCart();
  });
  afterEach(() => {
    clearCart();
  });

  it("60 + 40 passes with exact quantities", () => {
    const r1 = addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", 60);
    expect(r1.error).toBeNull();
    const r2 = addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", 40);
    expect(r2.error).toBeNull();
    expect(r2.cart?.items).toHaveLength(2);
    const q1 = r2.cart?.items.find((i) => i.planId === "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001")?.quantity;
    const q2 = r2.cart?.items.find((i) => i.planId === "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002")?.quantity;
    expect(q1).toBe(60);
    expect(q2).toBe(40);
  });

  it("60 existing + attempt 41 rejects with MAX_TOTAL_KNIVES and preserves state", () => {
    addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", 60);
    const before = readCart();
    const result = addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", 41);
    expect(result.error).toBe("MAX_TOTAL_KNIVES");
    const after = readCart();
    expect(after).toEqual(before);
    expect(after?.items).toHaveLength(1);
    expect(after?.items[0]?.quantity).toBe(60);
  });

  it("99 + 1 passes", () => {
    addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", 99);
    const result = addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", 1);
    expect(result.error).toBeNull();
    expect(result.cart?.items).toHaveLength(2);
  });

  it("100 + 1 rejects with MAX_TOTAL_KNIVES and cart identical to previous", () => {
    addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", 100);
    const before = readCart();
    const result = addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", 1);
    expect(result.error).toBe("MAX_TOTAL_KNIVES");
    const after = readCart();
    expect(after).toEqual(before);
    expect(after?.items).toHaveLength(1);
    expect(after?.items[0]?.quantity).toBe(100);
  });

  it("updateQuantity 40->41 when 60 exists rejects and preserves 60+40", () => {
    addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", 60);
    addToCart("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", 40);
    const before = readCart();
    const result = updateQuantity("b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002", 41);
    expect(result.error).toBe("MAX_TOTAL_KNIVES");
    const after = readCart();
    expect(after).toEqual(before);
    const q1 = after?.items.find((i) => i.planId === "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001")?.quantity;
    const q2 = after?.items.find((i) => i.planId === "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0002")?.quantity;
    expect(q1).toBe(60);
    expect(q2).toBe(40);
  });
});