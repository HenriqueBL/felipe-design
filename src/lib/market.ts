import type { Locale } from "@/lib/i18n/config";
import type { Currency } from "@/types/database";

export interface Market {
  country: string | null;
  locale: Locale;
  currency: Currency;
}

/**
 * The ONLY header the application trusts for production geo resolution.
 * This is an INTERNAL origin header written by nginx after validating
 * upstream geo data (e.g., Cloudflare CF-IPCountry). Internet clients
 * must never be able to inject this header directly.
 *
 * TRUSTED_GEO_SOURCE must equal this constant in production to enable
 * geo-based market resolution. Any other value is rejected by both
 * runtime code and the production env validator.
 */
export const TRUSTED_INTERNAL_GEO_HEADER = "x-origin-country";

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
 * Production geo is DISABLED until the full trust boundary is configured:
 *   Cloudflare → CF-IPCountry → nginx → X-Origin-Country → app.
 * To enable, set TRUSTED_GEO_SOURCE=x-origin-country AFTER nginx is
 * configured to overwrite that header from a trusted upstream source
 * and strip all client-supplied geo headers. Without this env var,
 * ALL production traffic falls back to en/USD — preventing spoofed
 * headers from influencing locale/currency.
 *
 * SECURITY: In production, only `x-origin-country` is accepted as the
 * trusted geo header. Setting TRUSTED_GEO_SOURCE to any other value
 * (e.g., cf-ipcountry, x-vercel-ip-country) is ignored at runtime and
 * rejected by the production env validator. This prevents accidentally
 * trusting internet-facing headers that clients can forge.
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
  // Only trust the internal origin header when explicitly configured.
  if (isProd) {
    const trustedSource = process.env.TRUSTED_GEO_SOURCE;
    // Only accept the hardcoded internal header — reject any other value
    // to prevent accidentally trusting internet-facing headers like
    // cf-ipcountry or x-vercel-ip-country that clients can forge.
    if (trustedSource !== TRUSTED_INTERNAL_GEO_HEADER) {
      return null;
    }
    const value = headers.get(TRUSTED_INTERNAL_GEO_HEADER);
    if (value && value.length === 2) {
      return value.toUpperCase();
    }
    return null;
  }

  // Non-production fallback (should not reach here, but safety net)
  return null;
}