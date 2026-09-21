import { describe, expect, it } from "vitest";
import { detectPreferredLocale } from "@/lib/i18n/detect-locale";

describe("detectPreferredLocale", () => {
  it("pt-BR,pt;q=0.9,en;q=0.8 => pt", () => {
    expect(
      detectPreferredLocale({ acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8" }),
    ).toBe("pt");
  });

  it("pt-PT,pt;q=0.9,en;q=0.8 => pt", () => {
    expect(
      detectPreferredLocale({ acceptLanguage: "pt-PT,pt;q=0.9,en;q=0.8" }),
    ).toBe("pt");
  });

  it("en-US,en;q=0.9 => en", () => {
    expect(detectPreferredLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe(
      "en",
    );
  });

  it("en-US,en;q=0.9,pt;q=0.5 => en (respects q-value priority)", () => {
    expect(
      detectPreferredLocale({ acceptLanguage: "en-US,en;q=0.9,pt;q=0.5" }),
    ).toBe("en");
  });

  it("fr-FR,fr;q=0.9,en;q=0.8 => en (unsupported language falls back)", () => {
    expect(
      detectPreferredLocale({ acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8" }),
    ).toBe("en");
  });

  it("no Accept-Language + country BR => pt", () => {
    expect(detectPreferredLocale({ country: "BR" })).toBe("pt");
  });

  it("no Accept-Language + no country => en (absolute fallback)", () => {
    expect(detectPreferredLocale({})).toBe("en");
  });

  it("no Accept-Language + country US => en", () => {
    expect(detectPreferredLocale({ country: "US" })).toBe("en");
  });

  it("pt;q=0.5,en;q=0.9 => en (lower q-value loses)", () => {
    expect(
      detectPreferredLocale({ acceptLanguage: "pt;q=0.5,en;q=0.9" }),
    ).toBe("en");
  });

  it("empty Accept-Language + country PT => pt", () => {
    expect(detectPreferredLocale({ acceptLanguage: "", country: "PT" })).toBe(
      "pt",
    );
  });

  it("pt;q=0,en;q=0.8 => en (q=0 means explicitly rejected)", () => {
    expect(
      detectPreferredLocale({ acceptLanguage: "pt;q=0,en;q=0.8" }),
    ).toBe("en");
  });

  it("pt;q=0 => fallback to country/default (q=0 excludes pt)", () => {
    expect(detectPreferredLocale({ acceptLanguage: "pt;q=0" })).toBe("en");
  });

  it("cf-ipcountry BR => pt (Cloudflare header)", () => {
    expect(detectPreferredLocale({ country: "BR" })).toBe("pt");
  });
});