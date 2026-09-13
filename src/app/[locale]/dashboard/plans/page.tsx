import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { listPlans } from "@/services/plans";
import PlanPriceForm from "@/components/dashboard/plan-price-form";
import PlanToggleForm from "@/components/dashboard/plan-toggle-form";

export default async function DashboardPlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const plans = await listPlans();

  return (
    <div>
      <h1>{dictionary.dashboard.plansTitle}</h1>
      {plans.map((plan) => (
        <div className="panel" key={plan.id}>
          <h2>
            {plan.angles} {dictionary.dashboard.planAngles}
          </h2>
          <PlanToggleForm
            locale={current}
            plan={plan}
            labels={{
              activate: dictionary.dashboard.activate,
              deactivate: dictionary.dashboard.deactivate,
              active: dictionary.dashboard.active,
              inactive: dictionary.dashboard.inactive,
              saved: dictionary.dashboard.saved,
              saveError: dictionary.dashboard.saveError,
            }}
          />
          <PlanPriceForm
            locale={current}
            plan={plan}
            prices={plan.prices}
            labels={{
              updatePrice: dictionary.dashboard.updatePrice,
              currentPrice: dictionary.dashboard.currentPrice,
              noPriceSet: dictionary.dashboard.noPriceSet,
              validFrom: dictionary.dashboard.validFrom,
              saved: dictionary.dashboard.saved,
              saveError: dictionary.dashboard.saveError,
            }}
          />
        </div>
      ))}
    </div>
  );
}
