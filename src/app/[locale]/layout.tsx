import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Inter, Instrument_Serif } from "next/font/google";
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
import AuthNav from "@/components/auth-nav";
import CartBadge from "@/components/cart/cart-badge";
import HeaderScrollState from "@/components/header-scroll-state";
import MobileNav from "@/components/mobile-nav";
import "../globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

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
  const year = new Date().getFullYear();

  return (
    <html lang={current} className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className="cinematic-shell">
        <a className="skip-link" href="#main-content">
          {dictionary.common.skipToContent}
        </a>
        <HeaderScrollState />
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
              <AuthNav
                locale={current}
                labels={{ login: dictionary.nav.login, logout: dictionary.nav.logout }}
              />
              <CartBadge locale={current} label={dictionary.nav.cart} />
            </nav>
            <MobileNav
              locale={current}
              labels={{
                home: dictionary.nav.home,
                services: dictionary.nav.services,
                about: dictionary.nav.about,
                gallery: dictionary.nav.gallery,
                account: dictionary.nav.account,
                login: dictionary.nav.login,
                logout: dictionary.nav.logout,
                cart: dictionary.nav.cart,
                openMenu: dictionary.mobileNav.openMenu,
                closeMenu: dictionary.mobileNav.closeMenu,
                navigationMenu: dictionary.mobileNav.navigationMenu,
              }}
            />
          </div>
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
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
                      </div>
          <div className="container footer-bottom">
            <p>{dictionary.footer.copyright(year)}</p>
            <p className="footer-credit">
              {dictionary.footer.developerCredit}{" "}
              <a
                href="https://www.linkedin.com/in/henriquebdl/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {dictionary.footer.developerName}
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}