import { describe, expect, it } from "vitest";
import { detectPreferredLocale } from "@/lib/i18n/detect-locale";

function headersWithCountry(country: string | null): Headers {
  const h = new Headers();
  if (country) {
    h.set("x-test-country", country);
  }
  return h;
}

describe("detectPreferredLocale", () => {
  it("country BR => pt", () => {
    expect(detectPreferredLocale(headersWithCountry("BR"))).toBe("pt");
  });

  it("country US => en", () => {
    expect(detectPreferredLocale(headersWithCountry("US"))).toBe("en");
  });

  it("country PT => en (non-BR always en)", () => {
    expect(detectPreferredLocale(headersWithCountry("PT"))).toBe("en");
  });

  it("country AO => en", () => {
    expect(detectPreferredLocale(headersWithCountry("AO"))).toBe("en");
  });

  it("no country header => en (fallback)", () => {
    expect(detectPreferredLocale(new Headers())).toBe("en");
  });

  it("Accept-Language is ignored: BR + en-US => pt", () => {
    const h = headersWithCountry("BR");
    h.set("accept-language", "en-US,en;q=0.9");
    expect(detectPreferredLocale(h)).toBe("pt");
  });

  it("Accept-Language is ignored: US + pt-BR => en", () => {
    const h = headersWithCountry("US");
    h.set("accept-language", "pt-BR,pt;q=0.9");
    expect(detectPreferredLocale(h)).toBe("en");
  });
});