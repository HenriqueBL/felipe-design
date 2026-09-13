import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n/config";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

function resolveLocale(locale: string): Locale {
  return isLocale(locale) ? locale : defaultLocale;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const current = resolveLocale(locale);
  const dictionary = await getDictionary(current);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  return {
    title: dictionary.meta.title,
    description: dictionary.meta.description,
    alternates: {
      canonical: `${siteUrl}/${current}`,
      languages: {
        en: `${siteUrl}/en`,
        pt: `${siteUrl}/pt`,
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current = resolveLocale(locale);
  const dictionary = await getDictionary(current);

  return (
    <html lang={current}>
      <body>
        <header className="site-header">
          <div className="container">
            <Link href={`/${current}`} className="brand">
              Felipe Design
            </Link>
            <nav className="site-nav">
              <Link href={`/${current}/login`}>{dictionary.nav.login}</Link>
              <div className="locale-switch">
                <Link href="/en" aria-label="English">
                  en
                </Link>
                <Link href="/pt" aria-label="Português">
                  pt
                </Link>
              </div>
            </nav>
          </div>
        </header>
        {children}
        <footer>
          <div className="container">Felipe Design</div>
        </footer>
      </body>
    </html>
  );
}
