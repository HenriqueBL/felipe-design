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
        en: base + "/en/services",
        pt: base + "/pt/servicos",
        "x-default": base + "/en/services",
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
      <section className="services-header">
        <div className="container">
          <h1>{dictionary.services.title}</h1>
          <p>{dictionary.services.subtitle}</p>
          <div className="currency-bar">
            <span>{dictionary.services.currencySwitch}</span>
            <div className="currency-toggle">
              {CURRENCIES.map((option) => (
                <Link
                  key={option}
                  href={servicesPath(current, option)}
                  className={option === currency ? "active" : ""}
                >
                  {option}
                </Link>
              ))}
            </div>
            <span className="currency-note">{dictionary.services.currencyNote}</span>
          </div>
        </div>
      </section>

      <section className="container">
        {loadError ? (
          <p className="state-note">{dictionary.services.loadError}</p>
        ) : plans.length === 0 ? (
          <p className="state-note">{dictionary.services.noPlans}</p>
        ) : (
          <div className="services-grid">
            {plans.map((plan) => {
              const price = plan.prices[currency];
              return (
                <article className="plan-card" key={plan.id}>
                  <div className="plan-angles">
                    {plan.angles} {dictionary.services.anglesLabel}
                  </div>
                  <h3>
                    {price !== null
                      ? formatMoney(price, currency, intlLocale)
                      : dictionary.services.priceUnavailable}
                  </h3>
                  <p className="plan-description">{descriptions[plan.angles] ?? ""}</p>
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
                    }}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
