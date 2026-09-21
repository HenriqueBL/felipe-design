import type { Locale } from "./config";

const SUPPORTED_LOCALES: Locale[] = ["en", "pt"];
const DEFAULT_LOCALE: Locale = "en";

interface DetectOptions {
  acceptLanguage?: string | null;
  country?: string | null;
}

/**
 * Parse an Accept-Language header into an ordered list of locale tags.
 * Respects q-values; defaults to q=1 when omitted.
 */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const segments = part.trim().split(";");
      const tag = segments[0];
      if (!tag) return null;
      const qPart = segments[1];
      const q = qPart ? parseFloat(qPart.replace(/^q=/i, "")) : 1;
      return { tag: tag.trim().toLowerCase(), q: isNaN(q) ? 0 : q };
    })
    .filter((entry): entry is { tag: string; q: number } => entry !== null)
    // Exclude q=0 (explicitly rejected languages per RFC 2616)
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

function matchLocale(tags: string[]): Locale | null {
  for (const tag of tags) {
    // Exact match first (e.g., "pt" or "en")
    if (SUPPORTED_LOCALES.includes(tag as Locale)) {
      return tag as Locale;
    }
    // Prefix match (e.g., "pt-BR" → "pt", "en-US" → "en")
    const prefix = tag.split("-")[0];
    if (SUPPORTED_LOCALES.includes(prefix as Locale)) {
      return prefix as Locale;
    }
  }
  return null;
}

export function detectPreferredLocale(options: DetectOptions): Locale {
  // A) Accept-Language takes priority (q=0 already excluded by parseAcceptLanguage)
  if (options.acceptLanguage) {
    const tags = parseAcceptLanguage(options.acceptLanguage);
    const matched = matchLocale(tags);
    if (matched) return matched;
  }

  // B) Country fallback (cf-ipcountry for Cloudflare, x-vercel-ip-country for Vercel)
  if (options.country) {
    const country = options.country.toUpperCase();
    if (country === "BR" || country === "PT" || country === "AO" || country === "MZ") {
      return "pt";
    }
  }

  // C) Absolute fallback
  return DEFAULT_LOCALE;
}