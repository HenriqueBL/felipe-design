import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n/config";
import { galleryPath, servicesPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { listPublishedPortfolioItems, portfolioPublicUrl } from "@/services/portfolio";

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
  const canonical = base + galleryPath(locale);

  return {
    title: dictionary.gallery.metaTitle,
    description: dictionary.gallery.metaDescription,
    alternates: {
      canonical,
      languages: {
        en: base + "/en/gallery",
        pt: base + "/pt/galeria",
        "x-default": base + "/en/gallery",
      },
    },
    openGraph: {
      type: "website",
      siteName: "Felipe Design",
      locale: locale === "pt" ? "pt_BR" : "en_US",
      title: dictionary.gallery.metaTitle,
      description: dictionary.gallery.metaDescription,
      url: canonical,
    },
  };
}

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  const dictionary = await getDictionary(locale);

  // Fonte única: portfolio publicado no banco. Se zero itens ou falha,
  // mostra empty state localizado (sem 500, sem fallback estático).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let items: Array<{
    key: string;
    src: string | null;
    title: string;
    description: string | null;
  }> = [];
  try {
    const published = await listPublishedPortfolioItems();
    items = published.map((item) => ({
      key: item.id,
      src:
        item.resolvedMediaPath && supabaseUrl
          ? portfolioPublicUrl(supabaseUrl, item.resolvedMediaPath)
          : null,
      title: item.title,
      description: item.description,
    }));
  } catch {
    items = [];
  }

  return (
    <main>
      <section className="page-hero">
        <div className="container">
          <h1>{dictionary.gallery.title}</h1>
          <p className="about-lede">{dictionary.gallery.subtitle}</p>
        </div>
      </section>
      <section className="section">
        <div className="container">
          {items.length === 0 ? (
            <div className="state-note">
              <h2>{dictionary.gallery.emptyTitle}</h2>
              <p>{dictionary.gallery.emptyBody}</p>
              <Link href={servicesPath(locale)} className="btn btn-primary">
                {dictionary.nav.services}
              </Link>
            </div>
          ) : (
            <div className="gallery-grid">
              {items.map((item) =>
                item.src ? (
                  <figure key={item.key} className="gallery-item">
                    <Image
                      src={item.src}
                      alt={item.title}
                      width={800}
                      height={600}
                      sizes="(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 33vw"
                    />
                    {item.description ? (
                      <figcaption>
                        <strong>{item.title}</strong> — {item.description}
                      </figcaption>
                    ) : item.title ? (
                      <figcaption>{item.title}</figcaption>
                    ) : null}
                  </figure>
                ) : null,
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}