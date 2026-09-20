import Image from "next/image";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { servicesPath } from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";
import {
  getFeaturedPortfolioItem,
  portfolioPublicUrl,
} from "@/services/portfolio";

// Fallback versionado do hero: a Home nunca quebra por falta de destaque.
const HERO_FALLBACK_SRC = "/home/hero-fallback.svg";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  const featured = await getFeaturedPortfolioItem();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const heroSrc =
    featured && featured.imageStoragePath && supabaseUrl
      ? portfolioPublicUrl(supabaseUrl, featured.imageStoragePath)
      : HERO_FALLBACK_SRC;
  const heroAlt = featured ? featured.title : dictionary.home.heroTitle;

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Felipe Design",
    url: siteUrl() + publicPath(current, "home"),
    description: dictionary.meta.description,
    inLanguage: current === "pt" ? "pt-BR" : "en",
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <section className="hero hero-featured">
        <Image
          src={heroSrc}
          alt={heroAlt}
          fill
          priority
          sizes="100vw"
          className="hero-media"
          style={{ objectFit: "cover", objectPosition: "center" }}
        />
        <div className="hero-overlay" aria-hidden="true" />
        <div className="container hero-content">
          <h1>{dictionary.home.heroTitle}</h1>
          <p>{dictionary.home.heroSubtitle}</p>
          <div className="hero-actions">
            <Link href={servicesPath(current)} className="btn btn-primary">
              {dictionary.home.ctaPrimary}
            </Link>
            <a href="#before-after" className="btn btn-secondary">
              {dictionary.home.ctaSecondary}
            </a>
          </div>
        </div>
      </section>

      <section className="section" id="before-after">
        <div className="container">
          <h2>{dictionary.home.beforeAfterTitle}</h2>
          <div className="before-after-grid">
            <div className="before-after">
              <div className="ba-images">
                <div className="ba-side">{dictionary.home.beforeLabel}</div>
                <div className="ba-side">{dictionary.home.afterLabel}</div>
              </div>
              <div className="ba-caption">{dictionary.home.portfolioComingSoon}</div>
            </div>
            <div className="before-after">
              <div className="ba-images">
                <div className="ba-side">{dictionary.home.beforeLabel}</div>
                <div className="ba-side">{dictionary.home.afterLabel}</div>
              </div>
              <div className="ba-caption">{dictionary.home.portfolioComingSoon}</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
