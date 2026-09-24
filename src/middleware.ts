import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { extractCountry, resolveMarket } from "@/lib/market";
import { updateSession } from "@/lib/supabase/middleware";

// Map PT public slugs to internal EN equivalents and vice versa.
const PT_TO_EN: Record<string, string> = {
  servicos: "services",
  sobre: "about",
  galeria: "gallery",
  finalizar: "checkout",
  carrinho: "cart",
  conta: "account",
};

const EN_TO_PT: Record<string, string> = Object.fromEntries(
  Object.entries(PT_TO_EN).map(([pt, en]) => [en, pt]),
);

// Crawler User-Agents that should access both locales without redirect
// so hreflang/canonical indexing works correctly.
const CRAWLER_PATTERN = /googlebot|bingbot|yandexbot|duckduckbot|slurp|msnbot|teoma|ask jeeves|crawler|spider|bot\b/i;

function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return CRAWLER_PATTERN.test(userAgent);
}

/**
 * Build the equivalent path in a target locale, preserving slug mappings.
 * e.g., /pt/servicos → /en/services, /en/about → /pt/sobre
 */
function localizePath(pathname: string, targetLocale: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const currentLocale = segments[0] ?? "";
  const rest = segments.slice(1);

  if (!isLocale(currentLocale)) {
    return `/${targetLocale}${pathname}`;
  }

  // Translate first segment after locale if it's a known slug
  let translatedRest = rest;
  if (rest.length > 0) {
    const firstSlug = rest[0] ?? "";
    if (targetLocale === "en" && PT_TO_EN[firstSlug]) {
      translatedRest = [PT_TO_EN[firstSlug], ...rest.slice(1)];
    } else if (targetLocale === "pt" && EN_TO_PT[firstSlug]) {
      translatedRest = [EN_TO_PT[firstSlug], ...rest.slice(1)];
    }
  }

  return `/${targetLocale}/${translatedRest.join("/")}`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const country = extractCountry(request.headers);
  const market = resolveMarket(country);
  const userAgent = request.headers.get("user-agent");

  // Root redirect: always send humans to their market locale
  if (pathname === "/") {
    if (!isCrawler(userAgent)) {
      return NextResponse.redirect(new URL(`/${market.locale}`, request.url));
    }
    // Crawlers hitting root: default to EN (x-default)
    return NextResponse.redirect(new URL("/en", request.url));
  }

  const { response, supabase, user } = await updateSession(request);

  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0] ?? "";
  if (!isLocale(maybeLocale)) {
    return response;
  }
  const currentLocale = maybeLocale;

  // Geo-redirect: if human visitor is on wrong locale for their market, redirect
  if (!isCrawler(userAgent) && currentLocale !== market.locale) {
    const targetPath = localizePath(pathname, market.locale);
    const url = new URL(targetPath, request.url);
    // Preserve query params except currency (server-authoritative)
    request.nextUrl.searchParams.forEach((value, key) => {
      if (key !== "currency") {
        url.searchParams.set(key, value);
      }
    });
    return NextResponse.redirect(url);
  }

  // Area do cliente exige autenticacao; o fluxo original e preservado via next.
  // Middleware roda antes dos rewrites, entao cobrimos tambem o caminho publico de PT.
  const section = segments[1] ?? "";
  if ((section === "account" || section === "conta") && !user) {
    const loginUrl = new URL(`/${currentLocale}/login`, request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  if (segments[1] === "dashboard") {
    if (!user) {
      const loginUrl = new URL(`/${currentLocale}/login`, request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.role !== "admin") {
      return NextResponse.redirect(new URL(`/${currentLocale}`, request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/", "/en/:path*", "/pt/:path*"],
};