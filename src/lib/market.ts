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
 *
 * PRODUCTION DEFAULT: returns null (en/USD fallback).
 * Production geo headers are DISABLED until infrastructure is explicitly
 * configured. To enable, set TRUSTED_GEO_SOURCE=cf-ipcountry (or another
 * header name that nginx/proxy strips from client requests and injects
 * from a trusted source). Without this env var, ALL production traffic
 * falls back to en/USD regardless of any cf-ipcountry or
 * x-vercel-ip-country header present in the request — preventing spoofed
 * headers from influencing locale/currency on unconfigured VPS.
 *
 * DEV/TEST (NODE_ENV !== "production"): accepts x-test-country for
 * simulation without requiring real geo infrastructure.
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

  // Production: geo headers are DISABLED by default.
  // Only read a header if TRUSTED_GEO_SOURCE is explicitly configured,
  // meaning the operator has confirmed their proxy strips client-supplied
  // values and injects a trusted one.
  if (isProd) {
    const trustedHeader = process.env.TRUSTED_GEO_SOURCE;
    if (trustedHeader) {
      const value = headers.get(trustedHeader);
      if (value && value.length === 2) {
        return value.toUpperCase();
      }
    }
    // No trusted source configured → fallback
    return null;
  }

  // Non-production fallback (should not reach here, but safety net)
  return null;
}