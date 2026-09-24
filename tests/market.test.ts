import { describe, expect, it } from "vitest";
import { resolveMarket, extractCountry } from "@/lib/market";

describe("resolveMarket", () => {
  it("BR → pt/BRL", () => {
    const m = resolveMarket("BR");
    expect(m.locale).toBe("pt");
    expect(m.currency).toBe("BRL");
    expect(m.country).toBe("BR");
  });

  it("br (lowercase) → pt/BRL", () => {
    const m = resolveMarket("br");
    expect(m.locale).toBe("pt");
    expect(m.currency).toBe("BRL");
  });

  it("US → en/USD", () => {
    const m = resolveMarket("US");
    expect(m.locale).toBe("en");
    expect(m.currency).toBe("USD");
  });

  it("PT → en/USD (non-BR always en)", () => {
    const m = resolveMarket("PT");
    expect(m.locale).toBe("en");
    expect(m.currency).toBe("USD");
  });

  it("AO → en/USD", () => {
    expect(resolveMarket("AO").locale).toBe("en");
    expect(resolveMarket("AO").currency).toBe("USD");
  });

  it("MZ → en/USD", () => {
    expect(resolveMarket("MZ").locale).toBe("en");
    expect(resolveMarket("MZ").currency).toBe("USD");
  });

  it("FR → en/USD", () => {
    expect(resolveMarket("FR").locale).toBe("en");
    expect(resolveMarket("FR").currency).toBe("USD");
  });

  it("CA → en/USD", () => {
    expect(resolveMarket("CA").locale).toBe("en");
    expect(resolveMarket("CA").currency).toBe("USD");
  });

  it("null → en/USD (fallback)", () => {
    const m = resolveMarket(null);
    expect(m.locale).toBe("en");
    expect(m.currency).toBe("USD");
    expect(m.country).toBeNull();
  });

  it("undefined → en/USD (fallback)", () => {
    expect(resolveMarket(undefined).locale).toBe("en");
    expect(resolveMarket(undefined).currency).toBe("USD");
  });

  it("empty string → en/USD (fallback)", () => {
    expect(resolveMarket("").locale).toBe("en");
    expect(resolveMarket("").currency).toBe("USD");
  });

  it("invalid code XX → en/USD (fallback)", () => {
    expect(resolveMarket("XX").locale).toBe("en");
    expect(resolveMarket("XX").currency).toBe("USD");
  });
});

describe("extractCountry", () => {
  it("reads x-test-country in non-production", () => {
    // In test env, NODE_ENV is not "production"
    const h = new Headers();
    h.set("x-test-country", "BR");
    expect(extractCountry(h)).toBe("BR");
  });

  it("normalizes x-test-country to uppercase", () => {
    const h = new Headers();
    h.set("x-test-country", "us");
    expect(extractCountry(h)).toBe("US");
  });

  it("ignores x-test-country with invalid length", () => {
    const h = new Headers();
    h.set("x-test-country", "BRA");
    // Falls through to cf-ipcountry / x-vercel-ip-country (none set)
    expect(extractCountry(h)).toBeNull();
  });

  it("returns null when no headers present", () => {
    expect(extractCountry(new Headers())).toBeNull();
  });
});

describe("currencyForCountry", () => {
  // Re-exported via domain/checkout for convenience
  it("is accessible from domain layer", async () => {
    const { currencyForCountry } = await import("@/domain/checkout");
    expect(currencyForCountry("BR")).toBe("BRL");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry(null)).toBe("USD");
  });
});