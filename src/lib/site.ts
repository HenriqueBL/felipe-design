import { defaultLocale, type Locale } from "@/lib/i18n/config";

// TODO(launch): set NEXT_PUBLIC_SITE_URL to the production domain before deploy.
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function publicPath(locale: Locale, page: "home" | "services"): string {
  if (page === "home") {
    return `/${locale}`;
  }
  return locale === defaultLocale ? `/${locale}/services` : `/${locale}/servicos`;
}

export function siteName(): string {
  return "Felipe Design";
}
