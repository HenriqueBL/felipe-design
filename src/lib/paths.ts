import type { Locale } from "@/lib/i18n/config";
import type { Currency } from "@/types/database";

// Caminhos publicos semanticos por idioma. As rotas internas usam slugs em
// ingles e o next.config reescreve os caminhos publicos de /pt.
export function servicesPath(locale: Locale, currency?: Currency): string {
  const base = locale === "en" ? "/en/services" : "/pt/servicos";
  return currency ? base + "?currency=" + currency : base;
}

export function checkoutPath(locale: Locale): string {
  return locale === "en" ? "/en/checkout" : "/pt/finalizar";
}

export function accountPath(locale: Locale): string {
  return locale === "en" ? "/en/account" : "/pt/conta";
}

export function accountOrderPath(locale: Locale, orderId: string): string {
  return locale === "en"
    ? "/en/account/orders/" + orderId
    : "/pt/conta/pedidos/" + orderId;
}

export function loginPath(locale: Locale, next?: string): string {
  const base = "/" + locale + "/login";
  return next ? base + "?next=" + encodeURIComponent(next) : base;
}

export function homePath(locale: Locale): string {
  return "/" + locale;
}
