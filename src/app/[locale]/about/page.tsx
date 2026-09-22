import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n/config";
import { galleryPath } from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const dictionary = await getDictionary(locale);
  const base = siteUrl();
  const canonical = base + publicPath(locale, "about");

  return {
    title: dictionary.about.metaTitle,
    description: dictionary.about.metaDescription,
    alternates: {
      canonical,
      languages: {
        en: base + publicPath("en", "about"),
        pt: base + publicPath("pt", "about"),
        "x-default": base + publicPath("en", "about"),
      },
    },
    openGraph: {
      type: "website",
      siteName: "Felipe Design",
      locale: locale === "pt" ? "pt_BR" : "en_US",
      alternateLocale: locale === "pt" ? ["en_US"] : ["pt_BR"],
      title: dictionary.about.metaTitle,
      description: dictionary.about.metaDescription,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: dictionary.about.metaTitle,
      description: dictionary.about.metaDescription,
    },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  const dictionary = await getDictionary(locale);

  return (
    <main>
      {/* ─── CINEMATIC PAGE HERO ─────────────────────────────── */}
      <section className="cinematic-page-hero">
        <div className="container">
          <p className="section-eyebrow">
            {locale === "pt" ? "Sobre" : "About"}
          </p>
          <h1>{dictionary.about.title}</h1>
          <p className="cinematic-page-subtitle">{dictionary.about.lede}</p>
        </div>
      </section>

      {/* ─── EDITORIAL BODY ──────────────────────────────────── */}
      <section className="section cinematic-about-body">
        <div className="container">
          <div className="cinematic-about-prose">
            {dictionary.about.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
          </div>
          <div className="cinematic-about-cta">
            <Link href={galleryPath(locale)} className="btn btn-primary btn-lg">
              {dictionary.about.ctaGallery}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}