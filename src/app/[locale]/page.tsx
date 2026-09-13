import Link from "next/link";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  return (
    <main>
      <section className="hero">
        <div className="container">
          <h1>{dictionary.home.heroTitle}</h1>
          <p>{dictionary.home.heroSubtitle}</p>
          <div className="hero-actions">
            <Link href={`/${current}/login`} className="btn btn-primary">
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
              <div className="ba-caption">Portfolio coming soon</div>
            </div>
            <div className="before-after">
              <div className="ba-images">
                <div className="ba-side">{dictionary.home.beforeLabel}</div>
                <div className="ba-side">{dictionary.home.afterLabel}</div>
              </div>
              <div className="ba-caption">Portfolio coming soon</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
