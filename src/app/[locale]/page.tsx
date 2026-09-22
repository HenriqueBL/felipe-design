import Image from "next/image";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { servicesPath, galleryPath, aboutPath } from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";
import {
  getFeaturedPortfolioItem,
  listPublishedPortfolioItems,
  portfolioPublicUrl,
} from "@/services/portfolio";
import { listActivePlans, type ActivePlan } from "@/services/plans";
import { formatMoney } from "@/lib/format";

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
  // Usa resolvedMediaPath (image → after → before) para suportar itens
  // novos e legacy sem duplicar paths artificialmente.
  const heroSrc =
    featured && featured.resolvedMediaPath && supabaseUrl
      ? portfolioPublicUrl(supabaseUrl, featured.resolvedMediaPath)
      : HERO_FALLBACK_SRC;
  const heroAlt = featured ? featured.title : dictionary.home.heroTitle;

  // Fetch published items for Selected Work section
  const publishedItems = await listPublishedPortfolioItems();
  const selectedWork = publishedItems.slice(0, 6);

  // Fetch active plans for Services preview (safe fallback: never 500)
  let plans: ActivePlan[] = [];
  try {
    plans = await listActivePlans();
  } catch {
    // Supabase unavailable: omit preview section gracefully
    plans = [];
  }
  const currency = current === "pt" ? "BRL" : "USD";
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

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

      {/* ─── CINEMATIC HERO ─────────────────────────────────────── */}
      <section className="cinematic-hero">
        <div className="cinematic-hero-media">
          <Image
            src={heroSrc}
            alt={heroAlt}
            fill
            priority
            sizes="100vw"
            className="cinematic-hero-img"
            style={{ objectFit: "cover", objectPosition: "center 30%" }}
          />
          <div className="cinematic-hero-overlay" aria-hidden="true" />
          <div className="cinematic-hero-gradient" aria-hidden="true" />
        </div>
        <div className="container cinematic-hero-content">
          <p className="cinematic-eyebrow">
            {dictionary.home.heroEyebrow}
          </p>
          <h1>{dictionary.home.heroTitle}</h1>
          <p className="cinematic-hero-subtitle">{dictionary.home.heroSubtitle}</p>
          <div className="cinematic-hero-actions">
            <Link href={servicesPath(current)} className="btn btn-primary btn-lg">
              {dictionary.home.ctaPrimary}
            </Link>
            <Link href={galleryPath(current)} className="btn btn-ghost btn-lg">
              {dictionary.home.ctaSecondary}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── FEATURED WORK ──────────────────────────────────────── */}
      {featured && (
        <section className="section cinematic-featured-work">
          <div className="container">
            <p className="section-eyebrow">
              {dictionary.home.featuredWorkEyebrow}
            </p>
            <div className="cinematic-featured-grid">
              <div className="cinematic-featured-image">
                {featured.resolvedMediaPath && supabaseUrl && (
                  <Image
                    src={portfolioPublicUrl(supabaseUrl, featured.resolvedMediaPath)}
                    alt={featured.title}
                    width={900}
                    height={600}
                    sizes="(max-width: 900px) 100vw, 900px"
                    className="cinematic-featured-img"
                  />
                )}
              </div>
              <div className="cinematic-featured-text">
                <h2>{featured.title}</h2>
                {featured.description && <p>{featured.description}</p>}
                <Link href={galleryPath(current)} className="btn btn-secondary">
                  {dictionary.home.featuredWorkCta}
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── THE PROCESS ────────────────────────────────────────── */}
      <section className="section cinematic-process">
        <div className="container">
          <p className="section-eyebrow">
            {dictionary.home.processEyebrow}
          </p>
          <h2>{dictionary.home.processTitle}</h2>
          <div className="cinematic-process-steps">
            <div className="cinematic-step">
              <span className="cinematic-step-number">01</span>
              <h3>{dictionary.home.processStep1Title}</h3>
              <p>{dictionary.home.processStep1Desc}</p>
            </div>
            <div className="cinematic-step">
              <span className="cinematic-step-number">02</span>
              <h3>{dictionary.home.processStep2Title}</h3>
              <p>{dictionary.home.processStep2Desc}</p>
            </div>
            <div className="cinematic-step">
              <span className="cinematic-step-number">03</span>
              <h3>{dictionary.home.processStep3Title}</h3>
              <p>{dictionary.home.processStep3Desc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SERVICES PREVIEW ───────────────────────────────────── */}
      <section className="section cinematic-services-preview">
        <div className="container">
          <p className="section-eyebrow">
            {dictionary.home.servicesEyebrow}
          </p>
          <h2>{dictionary.home.servicesTitle}</h2>
          <div className="cinematic-services-grid">
            {plans.map((plan: ActivePlan, idx: number) => {
              const priceCents = plan.prices[currency];
              return (
                <div key={plan.id} className="cinematic-service-card">
                  <span className="cinematic-service-number">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <h3>
                    {plan.angles} {plan.angles === 1 ? dictionary.home.servicesAngleSingular : dictionary.home.servicesAnglePlural}
                  </h3>
                  {priceCents !== null && (
                    <p className="cinematic-service-price">
                      {formatMoney(priceCents, currency, intlLocale)}
                    </p>
                  )}
                  <p className="cinematic-service-desc">
                    {dictionary.home.servicesPackageDesc.replace("{count}", String(plan.angles))}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="cinematic-services-cta">
            <Link href={servicesPath(current)} className="btn btn-primary">
              {dictionary.home.servicesViewAll}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── SELECTED WORK ──────────────────────────────────────── */}
      {selectedWork.length > 0 && (
        <section className="section cinematic-selected-work">
          <div className="container">
            <p className="section-eyebrow">
              {dictionary.home.selectedWorkEyebrow}
            </p>
            <h2>{dictionary.home.selectedWorkTitle}</h2>
            <div className="cinematic-gallery-grid">
              {selectedWork.map((item) => (
                <figure key={item.id} className="cinematic-gallery-item">
                  {item.resolvedMediaPath && supabaseUrl && (
                    <Image
                      src={portfolioPublicUrl(supabaseUrl, item.resolvedMediaPath)}
                      alt={item.title}
                      width={600}
                      height={400}
                      sizes="(max-width: 600px) 100vw, 600px"
                      className="cinematic-gallery-img"
                    />
                  )}
                  <figcaption>{item.title}</figcaption>
                </figure>
              ))}
            </div>
            <div className="cinematic-gallery-cta">
              <Link href={galleryPath(current)} className="btn btn-secondary">
                {dictionary.home.selectedWorkCta}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ─── ABOUT TEASER ───────────────────────────────────────── */}
      <section className="section cinematic-about-teaser">
        <div className="container">
          <div className="cinematic-about-content">
            <p className="section-eyebrow">
              {dictionary.home.aboutEyebrow}
            </p>
            <h2>{dictionary.home.aboutTitle}</h2>
            <p>{dictionary.home.aboutDesc}</p>
            <Link href={aboutPath(current)} className="btn btn-ghost">
              {dictionary.home.aboutCta}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ──────────────────────────────────────────── */}
      <section className="section cinematic-final-cta">
        <div className="container">
          <h2>{dictionary.home.finalCtaTitle}</h2>
          <p>{dictionary.home.finalCtaDesc}</p>
          <Link href={servicesPath(current)} className="btn btn-primary btn-lg">
            {dictionary.home.ctaPrimary}
          </Link>
        </div>
      </section>
    </main>
  );
}