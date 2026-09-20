import { describe, expect, it } from "vitest";

import {
  CART_MAX_ITEMS,
  CART_STORAGE_KEY,
  cartOutputImages,
  normalizeCart,
} from "@/domain/cart";

describe("normalizeCart", () => {
  it("accepts a valid cart", () => {
    const cart = normalizeCart({
      currency: "BRL",
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 2 }],
    });
    expect(cart).toEqual({
      currency: "BRL",
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
    expect(cart).toEqual({
      currency: "USD",
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
    expect(cart?.items[0].quantity).toBe(3);
  });

  it("caps merged quantity at 100", () => {
    const cart = normalizeCart({
      currency: "BRL",
      items: [
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 60 },
        { planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 60 },
      ],
    });
    expect(cart?.items[0].quantity).toBe(100);
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

  it("round-trips localStorage JSON", () => {
    const original = {
      currency: "BRL",
      items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
    };
    const roundTripped = normalizeCart(JSON.parse(JSON.stringify(original)));
    expect(roundTripped).toEqual(original);
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