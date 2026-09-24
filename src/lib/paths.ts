import type { Locale } from "@/lib/i18n/config";

// Caminhos publicos semanticos por idioma. As rotas internas usam slugs em
// ingles e o next.config reescreve os caminhos publicos de /pt.
export function servicesPath(locale: Locale): string {
  return locale === "en" ? "/en/services" : "/pt/servicos";
}

export function cartPath(locale: Locale): string {
  return locale === "en" ? "/en/cart" : "/pt/carrinho";
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

export function aboutPath(locale: Locale): string {
  return locale === "en" ? "/en/about" : "/pt/sobre";
}

export function galleryPath(locale: Locale): string {
  return locale === "en" ? "/en/gallery" : "/pt/galeria";
}