import type { Locale } from "./config";
import { extractCountry, resolveMarket } from "../market";

/**
 * Detect the preferred locale for a request based on geographic market.
 *
 * BR → pt
 * Everything else (including missing/unknown country) → en
 *
 * Accept-Language is intentionally NOT consulted: the commercial rule
 * locks locale to country, not browser preference.
 */
export function detectPreferredLocale(headers: Headers): Locale {
  const country = extractCountry(headers);
  return resolveMarket(country).locale;
}