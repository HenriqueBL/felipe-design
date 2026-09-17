import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GALLERY_ITEMS } from "@/lib/gallery";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, locales, type Locale } from "@/lib/i18n/config";
import { galleryPath, servicesPath } from "@/lib/paths";
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
          {GALLERY_ITEMS.length === 0 ? (
            <div className="state-note">
              <h2>{dictionary.gallery.emptyTitle}</h2>
              <p>{dictionary.gallery.emptyBody}</p>
              <Link href={servicesPath(locale)} className="btn btn-primary">
                {dictionary.nav.services}
              </Link>
            </div>
          ) : (
            <div className="gallery-grid">
              {GALLERY_ITEMS.map((item) => (
                <figure key={item.src} className="gallery-item">
                  <Image
                    src={item.src}
                    alt={item.alt[locale]}
                    width={item.width}
                    height={item.height}
                    sizes="(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 33vw"
                  />
                  {item.caption ? (
                    <figcaption>{item.caption[locale]}</figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}