import { describe, expect, it } from "vitest";
import { computeOrderPricing } from "@/services/pricing";

describe("computeOrderPricing", () => {
  it("calcula imagens e valores para 1 faca em 1 angulo", () => {
    const result = computeOrderPricing({
      unitPriceCents: 15000,
      knifeQuantity: 1,
      imagesPerKnife: 1,
    });
    expect(result.totalImages).toBe(1);
    expect(result.unitPriceCents).toBe(15000);
    expect(result.subtotalCents).toBe(15000);
    expect(result.totalCents).toBe(15000);
  });

  it("multiplica facas pelo preco unitario e imagens pelos angulos", () => {
    const result = computeOrderPricing({
      unitPriceCents: 25000,
      knifeQuantity: 3,
      imagesPerKnife: 2,
    });
    expect(result.totalImages).toBe(6);
    expect(result.subtotalCents).toBe(75000);
    expect(result.totalCents).toBe(75000);
  });

  it("rejeita quantidade zero", () => {
    expect(() =>
      computeOrderPricing({ unitPriceCents: 10000, knifeQuantity: 0, imagesPerKnife: 1 }),
    ).toThrow();
  });

  it("rejeita plano com 4 angulos", () => {
    expect(() =>
      computeOrderPricing({ unitPriceCents: 10000, knifeQuantity: 1, imagesPerKnife: 4 }),
    ).toThrow();
  });

  it("rejeita preco negativo", () => {
    expect(() =>
      computeOrderPricing({ unitPriceCents: -1, knifeQuantity: 1, imagesPerKnife: 1 }),
    ).toThrow();
  });
});
