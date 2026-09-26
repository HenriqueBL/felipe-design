import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n/config";
import { servicesPath } from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";
import { portfolioPublicUrl } from "@/lib/portfolio-url";
import {
  listPublishedPortfolioWorks,
  type PublicPortfolioWork,
} from "@/services/portfolio";

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
  const canonical = base + publicPath(locale, "gallery");

  return {
    title: dictionary.gallery.metaTitle,
    description: dictionary.gallery.metaDescription,
    alternates: {
      canonical,
      languages: {
        en: base + publicPath("en", "gallery"),
        pt: base + publicPath("pt", "gallery"),
        "x-default": base + publicPath("en", "gallery"),
      },
    },
    openGraph: {
      type: "website",
      siteName: "Felipe Design",
      locale: locale === "pt" ? "pt_BR" : "en_US",
      alternateLocale: locale === "pt" ? ["en_US"] : ["pt_BR"],
      title: dictionary.gallery.metaTitle,
      description: dictionary.gallery.metaDescription,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: dictionary.gallery.metaTitle,
      description: dictionary.gallery.metaDescription,
    },
  };
}

/**
 * Renders a single Work as one editorial unit containing 1–3 media.
 * Layout adapts based on media count:
 * - 1 media: single protagonist stage
 * - 2 media: balanced dual stage
 * - 3 media: asymmetric editorial grid (Angle1 large left, Angle2/3 stacked right)
 */
function WorkCard({
  work,
  supabaseUrl,
}: {
  work: PublicPortfolioWork;
  supabaseUrl: string;
}) {
  const mediaCount = work.media.length;
  if (mediaCount === 0) return null;

  const layoutClass =
    mediaCount === 1
      ? "gallery-work--1"
      : mediaCount === 2
        ? "gallery-work--2"
        : "gallery-work--3";

  return (
    <article className={`gallery-work ${layoutClass}`}>
      <div className="gallery-work-media">
        {work.media.map((m, idx) => {
          const src = portfolioPublicUrl(supabaseUrl, m.storagePath);
          const alt = m.altText ?? work.title;
          // Use real dimensions when available; fallback to stable contain wrapper
          const hasDims =
            m.width != null && m.height != null && m.width > 0 && m.height > 0;
          return (
            <div
              key={m.id}
              className={`gallery-work-angle gallery-work-angle-${idx + 1}`}
            >
              {hasDims ? (
                <Image
                  src={src}
                  alt={alt}
                  width={m.width!}
                  height={m.height!}
                  sizes="(max-width: 640px) 100vw, (max-width: 900px) 50vw, 33vw"
                  className="gallery-work-img"
                  loading="lazy"
                />
              ) : (
                <div className="gallery-work-contain-stage">
                  <Image
                    src={src}
                    alt={alt}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 900px) 50vw, 33vw"
                    className="gallery-work-img-contain"
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="gallery-work-caption">
        <h2 className="gallery-work-title">{work.title}</h2>
        {work.description && (
          <p className="gallery-work-desc">{work.description}</p>
        )}
      </div>
    </article>
  );
}

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  const dictionary = await getDictionary(locale);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  let works: PublicPortfolioWork[] = [];
  try {
    works = await listPublishedPortfolioWorks();
  } catch {
    works = [];
  }

  return (
    <main>
      {/* ─── CINEMATIC PAGE HERO ─────────────────────────────── */}
      <section className="cinematic-page-hero">
        <div className="container">
          <p className="section-eyebrow">
            {locale === "pt" ? "Portfólio" : "Portfolio"}
          </p>
          <h1>{dictionary.gallery.title}</h1>
          <p className="cinematic-page-subtitle">
            {dictionary.gallery.subtitle}
          </p>
        </div>
      </section>

      {/* ─── GALLERY GRID ────────────────────────────────────── */}
      <section className="section cinematic-gallery-section">
        <div className="container">
          {works.length === 0 ? (
            <div className="cinematic-empty-state">
              <h2>{dictionary.gallery.emptyTitle}</h2>
              <p>{dictionary.gallery.emptyBody}</p>
              <Link href={servicesPath(locale)} className="btn btn-primary">
                {dictionary.nav.services}
              </Link>
            </div>
          ) : (
            <div className="gallery-grid">
              {works.map((work) => (
                <WorkCard
                  key={work.id}
                  work={work}
                  supabaseUrl={supabaseUrl}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}