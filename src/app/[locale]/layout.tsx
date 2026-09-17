import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, locales, type Locale } from "@/lib/i18n/config";
import {
  aboutPath,
  galleryPath,
  homePath,
  accountPath,
  servicesPath,
} from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";
import { getCurrentUser } from "@/services/auth";
import { signOutAction } from "./actions";
import "../globals.css";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

function resolveLocale(locale: string): Locale {
  if (!isLocale(locale)) {
    notFound();
  }
  return locale;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const current = resolveLocale(locale);
  const dictionary = await getDictionary(current);
  const base = siteUrl();
  const canonical = base + publicPath(current, "home");

  return {
    title: dictionary.meta.title,
    description: dictionary.meta.description,
    alternates: {
      canonical,
      languages: {
        en: base + "/en",
        pt: base + "/pt",
        "x-default": base + "/en",
      },
    },
    openGraph: {
      type: "website",
      siteName: "Felipe Design",
      locale: current === "pt" ? "pt_BR" : "en_US",
      alternateLocale: current === "pt" ? ["en_US"] : ["pt_BR"],
      title: dictionary.meta.title,
      description: dictionary.meta.description,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: dictionary.meta.title,
      description: dictionary.meta.description,
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
  // Fonte de verdade do header e a sessao real do Supabase (Server Component).
  const user = await getCurrentUser();
  const year = new Date().getFullYear();

  return (
    <html lang={current}>
      <body>
        <header className="site-header">
          <div className="container">
            <Link href={homePath(current)} className="brand">
              <Image
                src="/branding/felipe-design-logo.jpeg"
                alt="Felipe Design"
                width={36}
                height={36}
                className="brand-logo"
                priority
              />
              <span>Felipe Design</span>
            </Link>
            <nav className="site-nav">
              <Link href={servicesPath(current)}>{dictionary.nav.services}</Link>
              <Link href={aboutPath(current)}>{dictionary.nav.about}</Link>
              <Link href={galleryPath(current)}>{dictionary.nav.gallery}</Link>
              <Link href={accountPath(current)}>{dictionary.nav.account}</Link>
              {user ? (
                <form action={signOutAction} className="inline">
                  <input type="hidden" name="locale" value={current} />
                  <button type="submit" className="linklike">
                    {dictionary.nav.logout}
                  </button>
                </form>
              ) : (
                <Link href={`/${current}/login`}>{dictionary.nav.login}</Link>
              )}
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
        <footer className="site-footer">
          <div className="container footer-grid">
            <div className="footer-brand">
              <Link href={homePath(current)} className="brand">
                <Image
                  src="/branding/felipe-design-logo.jpeg"
                  alt="Felipe Design"
                  width={40}
                  height={40}
                  className="brand-logo"
                />
                <span>Felipe Design</span>
              </Link>
              <p className="footer-tagline">{dictionary.footer.tagline}</p>
            </div>
            <nav aria-label={dictionary.footer.navigation} className="footer-nav">
              <h3>{dictionary.footer.navigation}</h3>
              <Link href={homePath(current)}>{dictionary.nav.home}</Link>
              <Link href={servicesPath(current)}>{dictionary.nav.services}</Link>
              <Link href={aboutPath(current)}>{dictionary.nav.about}</Link>
              <Link href={galleryPath(current)}>{dictionary.nav.gallery}</Link>
              <Link href={accountPath(current)}>{dictionary.nav.account}</Link>
            </nav>
            <div className="footer-locale">
              <h3>{dictionary.footer.language}</h3>
              <div className="locale-switch">
                <Link href="/en" aria-label="English">
                  English
                </Link>
                <Link href="/pt" aria-label="Português">
                  Português
                </Link>
              </div>
            </div>
          </div>
          <div className="container footer-bottom">
            <p>{dictionary.footer.copyright(year)}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}