import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { getAppSettings } from "@/services/settings";
import SettingsForm from "@/components/dashboard/settings-form";

export default async function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const settings = await getAppSettings();

  return (
    <div>
      <h1>{dictionary.dashboard.settingsTitle}</h1>
      <div className="panel">
        <SettingsForm
          locale={current}
          settings={settings}
          labels={{
            dailyCapacity: dictionary.dashboard.dailyCapacity,
            cutoffTime: dictionary.dashboard.cutoffTime,
            timezone: dictionary.dashboard.timezone,
            saved: dictionary.dashboard.saved,
            saveError: dictionary.dashboard.saveError,
            save: dictionary.common.save,
          }}
        />
      </div>
    </div>
  );
}
