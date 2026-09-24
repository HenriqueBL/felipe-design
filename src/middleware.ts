import { NextResponse, type NextRequest } from "next/server";
import { isLocale } from "@/lib/i18n/config";
import { extractCountry, resolveMarket } from "@/lib/market";
import { updateSession } from "@/lib/supabase/middleware";

// Map PT public slugs to internal EN equivalents and vice versa.
// Supports nested routes: conta/pedidos ↔ account/orders
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

// Nested sub-segment translations (second slug after locale)
const PT_SUB_TO_EN: Record<string, Record<string, string>> = {
  conta: { pedidos: "orders" },
};

const EN_SUB_TO_PT: Record<string, Record<string, string>> = {
  account: { orders: "pedidos" },
};

// Crawler User-Agents that should access both locales without redirect
// so hreflang/canonical indexing works correctly.
const CRAWLER_PATTERN = /googlebot|bingbot|yandexbot|duckduckbot|slurp|msnbot|teoma|ask jeeves|crawler|spider|bot\b/i;

function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return CRAWLER_PATTERN.test(userAgent);
}

/**
 * Build the equivalent path in a target locale, preserving slug mappings.
 * Handles nested routes: /pt/conta/pedidos/<id> → /en/account/orders/<id>
 */
function localizePath(pathname: string, targetLocale: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const currentLocale = segments[0] ?? "";
  const rest = segments.slice(1);

  if (!isLocale(currentLocale)) {
    return `/${targetLocale}${pathname}`;
  }

  const translatedRest = [...rest];

  // Translate first segment after locale
  if (rest.length > 0) {
    const firstSlug = rest[0] ?? "";
    if (targetLocale === "en" && PT_TO_EN[firstSlug]) {
      translatedRest[0] = PT_TO_EN[firstSlug];
    } else if (targetLocale === "pt" && EN_TO_PT[firstSlug]) {
      translatedRest[0] = EN_TO_PT[firstSlug];
    }

    // Translate second segment (nested routes like conta/pedidos → account/orders)
    if (rest.length > 1) {
      const secondSlug = rest[1] ?? "";
      if (targetLocale === "en") {
        const subMap = PT_SUB_TO_EN[firstSlug];
        if (subMap && subMap[secondSlug]) {
          translatedRest[1] = subMap[secondSlug];
        }
      } else if (targetLocale === "pt") {
        // After translating first slug to PT, check EN_SUB_TO_PT using original EN slug
        const enFirstSlug = PT_TO_EN[firstSlug] ?? firstSlug;
        const subMap = EN_SUB_TO_PT[enFirstSlug];
        if (subMap && subMap[secondSlug]) {
          translatedRest[1] = subMap[secondSlug];
        }
      }
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

  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0] ?? "";
  if (!isLocale(maybeLocale)) {
    // Not a localized route — pass through to updateSession
    const { response } = await updateSession(request);
    return response;
  }

  const currentLocale = maybeLocale;

  // Geo-redirect BEFORE updateSession: if human visitor is on wrong locale,
  // redirect first. This avoids discarding session cookies set by updateSession
  // when we immediately return a different redirect response.
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

  // Now on correct locale (or crawler) — safe to update session
  const { response, supabase, user } = await updateSession(request);

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