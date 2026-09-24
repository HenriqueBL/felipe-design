import type { Locale } from "@/lib/i18n/config";
import type { Currency } from "@/types/database";

export interface Market {
  country: string | null;
  locale: Locale;
  currency: Currency;
}

/**
 * Resolve market from country code.
 * BR → pt/BRL, everything else → en/USD
 * Fallback (null/undefined/invalid) → en/USD
 */
export function resolveMarket(country: string | null | undefined): Market {
  const normalized = country?.toUpperCase().trim();

  if (normalized === "BR") {
    return {
      country: "BR",
      locale: "pt",
      currency: "BRL",
    };
  }

  // Non-BR: always en/USD
  return {
    country: normalized && normalized.length === 2 ? normalized : null,
    locale: "en",
    currency: "USD",
  };
}

/**
 * Extract country from request headers.
 * In dev/test (NODE_ENV !== production): accepts x-test-country for simulation
 * In prod: reads cf-ipcountry ?? x-vercel-ip-country (trusted proxy only)
 * Returns null if no trusted header present or header is spoofable in prod
 */
export function extractCountry(headers: Headers): string | null {
  const isProd = process.env.NODE_ENV === "production";

  // Dev/test: allow manual override via x-test-country
  if (!isProd) {
    const testCountry = headers.get("x-test-country");
    if (testCountry && testCountry.length === 2) {
      return testCountry.toUpperCase();
    }
  }

  // Prod: only trust headers from known proxy infrastructure
  // cf-ipcountry (Cloudflare) or x-vercel-ip-country (Vercel)
  const cfCountry = headers.get("cf-ipcountry");
  if (cfCountry && cfCountry.length === 2) {
    return cfCountry.toUpperCase();
  }

  const vercelCountry = headers.get("x-vercel-ip-country");
  if (vercelCountry && vercelCountry.length === 2) {
    return vercelCountry.toUpperCase();
  }

  // No trusted header available
  return null;
}