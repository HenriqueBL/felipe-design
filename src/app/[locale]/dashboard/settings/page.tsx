import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { getAppSettings } from "@/services/settings";
import { getStripeAdminStatus, type StripeAdminStatus } from "@/services/stripe-config";
import SettingsForm from "@/components/dashboard/settings-form";
import StripeSettingsForm from "@/components/dashboard/stripe-settings-form";

export default async function DashboardSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const settings = await getAppSettings();

  // Status seguro: mode, flags de configuracao e last4 — nunca segredos.
  // Se o storage estiver indisponivel, a secao Stripe e renderizada como
  // nao configurada em vez de quebrar a pagina de Settings.
  let stripeStatus: StripeAdminStatus | null = null;
  try {
    stripeStatus = await getStripeAdminStatus();
  } catch {
    stripeStatus = null;
  }

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
            minSourcePhotosPerKnife: dictionary.dashboard.minSourcePhotosPerKnife,
            maxSourcePhotosPerKnife: dictionary.dashboard.maxSourcePhotosPerKnife,
            maxSourcePhotoSizeMb: dictionary.dashboard.maxSourcePhotoSizeMb,
            sourcePhotoSnapshotNote: dictionary.dashboard.sourcePhotoSnapshotNote,
            saved: dictionary.dashboard.saved,
            saveError: dictionary.dashboard.saveError,
            save: dictionary.common.save,
          }}
        />
      </div>
      <div className="panel">
        <h2>{dictionary.dashboard.stripePaymentsTitle}</h2>
        <StripeSettingsForm
          locale={current}
          status={stripeStatus}
          labels={{
            environment: dictionary.dashboard.stripeEnvironment,
            modeTest: dictionary.dashboard.stripeModeTest,
            modeLive: dictionary.dashboard.stripeModeLive,
            secretKey: dictionary.dashboard.stripeSecretKey,
            webhookSecret: dictionary.dashboard.stripeWebhookSecret,
            secretKeyHint: dictionary.dashboard.stripeSecretKeyHint,
            webhookConfigured: dictionary.dashboard.stripeWebhookConfigured,
            notConfigured: dictionary.dashboard.stripeNotConfigured,
            leaveBlankToKeep: dictionary.dashboard.stripeLeaveBlankToKeep,
            saveButton: dictionary.dashboard.stripeSaveButton,
            testButton: dictionary.dashboard.stripeTestButton,
            webhookVerifiedNote: dictionary.dashboard.stripeWebhookVerifiedNote,
          }}
        />
      </div>
    </div>
  );
}
