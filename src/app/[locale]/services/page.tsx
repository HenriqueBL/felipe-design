import type { Metadata } from "next";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { CURRENCIES, resolveCurrency } from "@/domain/checkout";
import { listActivePlans, type ActivePlan } from "@/services/plans";
import { formatMoney } from "@/lib/format";
import { servicesPath } from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";
import PlanSelector from "@/components/services/plan-selector";
import type { Currency } from "@/types/database";

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : defaultLocale;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const current = resolve((await params).locale);
  const dictionary = await getDictionary(current);
  const base = siteUrl();
  const canonical = base + publicPath(current, "services");

  return {
    title: dictionary.services.title + " | Felipe Design",
    description: dictionary.services.subtitle,
    alternates: {
      canonical,
      languages: {
        en: base + publicPath("en", "services"),
        pt: base + publicPath("pt", "services"),
        "x-default": base + publicPath("en", "services"),
      },
    },
    openGraph: {
      type: "website",
      siteName: "Felipe Design",
      locale: current === "pt" ? "pt_BR" : "en_US",
      alternateLocale: current === "pt" ? ["en_US"] : ["pt_BR"],
      title: dictionary.services.title + " | Felipe Design",
      description: dictionary.services.subtitle,
      url: canonical,
    },
    twitter: {
      card: "summary",
      title: dictionary.services.title + " | Felipe Design",
      description: dictionary.services.subtitle,
    },
  };
}

export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ currency?: string }>;
}) {
  const current = resolve((await params).locale);
  const { currency: currencyParam } = await searchParams;
  const dictionary = await getDictionary(current);
  const currency: Currency = resolveCurrency(current, currencyParam);
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  let plans: ActivePlan[] = [];
  let loadError = false;
  try {
    plans = await listActivePlans();
  } catch {
    loadError = true;
  }

  const descriptions: Record<number, string> = {
    1: dictionary.services.description1,
    2: dictionary.services.description2,
    3: dictionary.services.description3,
  };

  return (
    <main>
      {/* ─── CINEMATIC PAGE HERO ─────────────────────────────── */}
      <section className="cinematic-page-hero">
        <div className="container">
          <p className="section-eyebrow">
            {dictionary.services.title}
          </p>
          <h1>{dictionary.services.title}</h1>
          <p className="cinematic-page-subtitle">
            {dictionary.services.subtitle}
          </p>

          {/* Currency Toggle — preserved logic, cinematic styling */}
          <div className="cinematic-currency-bar">
            <span className="cinematic-currency-label">
              {dictionary.services.currencySwitch}
            </span>
            <div className="cinematic-currency-toggle">
              {CURRENCIES.map((option) => (
                <Link
                  key={option}
                  href={servicesPath(current, option)}
                  className={option === currency ? "active" : ""}
                  aria-current={option === currency ? "page" : undefined}
                >
                  {option}
                </Link>
              ))}
            </div>
            <span className="cinematic-currency-note">
              {dictionary.services.currencyNote}
            </span>
          </div>
        </div>
      </section>

      {/* ─── SERVICES GRID ───────────────────────────────────── */}
      <section className="section cinematic-services-section">
        <div className="container">
          {loadError ? (
            <div className="cinematic-empty-state">
              <h2>{dictionary.services.loadError}</h2>
            </div>
          ) : plans.length === 0 ? (
            <div className="cinematic-empty-state">
              <h2>{dictionary.services.noPlans}</h2>
            </div>
          ) : (
            <div className="cinematic-services-full-grid">
              {plans.map((plan, idx) => {
                const price = plan.prices[currency];
                return (
                  <article className="cinematic-service-full-card" key={plan.id}>
                    <span className="cinematic-service-full-number">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div className="cinematic-service-full-angles">
                      {plan.angles}{" "}
                      {plan.angles === 1
                        ? dictionary.services.angleSingular
                        : dictionary.services.anglePlural}
                    </div>
                    <h3 className="cinematic-service-full-price">
                      {price !== null
                        ? formatMoney(price, currency, intlLocale)
                        : dictionary.services.priceUnavailable}
                    </h3>
                    <p className="cinematic-service-full-desc">
                      {descriptions[plan.angles] ?? ""}
                    </p>
                    <div className="cinematic-service-full-action">
                      <PlanSelector
                        locale={current}
                        planId={plan.id}
                        currency={currency}
                        priceAvailable={price !== null}
                        labels={{
                          quantityLabel: dictionary.services.quantityLabel,
                          addToCart: dictionary.cart.addToCart,
                          addedToCart: dictionary.cart.addedToCart,
                          viewCart: dictionary.cart.viewCart,
                          unavailable: dictionary.services.unavailable,
                          maxKnivesError: dictionary.cart.maxKnivesError,
                        }}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}