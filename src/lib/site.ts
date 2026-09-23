import { defaultLocale, type Locale } from "@/lib/i18n/config";

// TODO(launch): set NEXT_PUBLIC_SITE_URL to the production domain before deploy.
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type PublicPage = "home" | "services" | "about" | "gallery";

export function publicPath(locale: Locale, page: PublicPage): string {
  switch (page) {
    case "home":
      return `/${locale}`;
    case "services":
      return locale === defaultLocale ? "/en/services" : "/pt/servicos";
    case "about":
      return locale === defaultLocale ? "/en/about" : "/pt/sobre";
    case "gallery":
      return locale === defaultLocale ? "/en/gallery" : "/pt/galeria";
  }
}

export function siteName(): string {
  return "Felipe Design";
}
