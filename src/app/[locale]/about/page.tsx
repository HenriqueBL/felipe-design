import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n/config";
import { aboutPath, galleryPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";

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
  const canonical = base + aboutPath(locale);

  return {
    title: dictionary.about.metaTitle,
    description: dictionary.about.metaDescription,
    alternates: {
      canonical,
      languages: {
        en: base + "/en/about",
        pt: base + "/pt/sobre",
        "x-default": base + "/en/about",
      },
    },
    openGraph: {
      type: "website",
      siteName: "Felipe Design",
      locale: locale === "pt" ? "pt_BR" : "en_US",
      title: dictionary.about.metaTitle,
      description: dictionary.about.metaDescription,
      url: canonical,
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
      <section className="page-hero">
        <div className="container">
          <h1>{dictionary.about.title}</h1>
          <p className="about-lede">{dictionary.about.lede}</p>
        </div>
      </section>
      <section className="section">
        <div className="container about-body">
          {dictionary.about.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 32)}>{paragraph}</p>
          ))}
          <div className="hero-actions">
            <Link href={galleryPath(locale)} className="btn btn-primary">
              {dictionary.about.ctaGallery}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}