"use client";

import { useActionState } from "react";
import {
  testStripeConnectionAction,
  updateStripeSettingsAction,
  type ActionResult,
} from "@/app/[locale]/dashboard/actions";
import type { StripeAdminStatus } from "@/services/stripe-config";

// Labels injetados pelo server: nunca contem segredo algum — apenas
// metadados seguros (mode, last4, flags de configuracao).
export interface StripeSettingsLabels {
  environment: string;
  modeTest: string;
  modeLive: string;
  secretKey: string;
  webhookSecret: string;
  secretKeyHint: string;
  webhookConfigured: string;
  notConfigured: string;
  leaveBlankToKeep: string;
  saveButton: string;
  testButton: string;
  webhookVerifiedNote: string;
}

// Client component: recebe SOMENTE o status seguro (sem secret material).
// Os password inputs comecam sempre vazios — nunca sao preenchidos com o
// segredo armazenado; vazio significa "preservar o atual".
export default function StripeSettingsForm({
  locale,
  status,
  labels,
}: {
  locale: string;
  status: StripeAdminStatus | null;
  labels: StripeSettingsLabels;
}) {
  const [saveState, saveAction, isSaving] = useActionState<ActionResult | null, FormData>(
    updateStripeSettingsAction.bind(null, locale),
    null,
  );
  const [testState, testAction, isTesting] = useActionState<ActionResult | null, FormData>(
    testStripeConnectionAction.bind(null, locale),
    null,
  );

  return (
    <div className="stripe-settings">
      <h2>{labels.environment}</h2>

      <form action={saveAction}>
        <div className="form-group">
          <label htmlFor="stripeMode">{labels.environment}</label>
          <select id="stripeMode" name="mode" defaultValue={status?.mode ?? "test"}>
            <option value="test">{labels.modeTest}</option>
            <option value="live">{labels.modeLive}</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="stripeSecretKey">{labels.secretKey}</label>
          {status?.secretKeyConfigured && status.secretKeyLast4 ? (
            <p className="hint">{labels.secretKeyHint}</p>
          ) : (
            <p className="hint">{labels.notConfigured}</p>
          )}
          <input
            id="stripeSecretKey"
            name="secretKey"
            type="password"
            autoComplete="off"
            placeholder={labels.leaveBlankToKeep}
          />
        </div>

        <div className="form-group">
          <label htmlFor="stripeWebhookSecret">{labels.webhookSecret}</label>
          <p className="hint">
            {status?.webhookSecretConfigured ? labels.webhookConfigured : labels.notConfigured}
          </p>
          <input
            id="stripeWebhookSecret"
            name="webhookSecret"
            type="password"
            autoComplete="off"
            placeholder={labels.leaveBlankToKeep}
          />
        </div>

        <button type="submit" disabled={isSaving}>
          {labels.saveButton}
        </button>

        {saveState?.message ? (
          <p role="status" aria-live="polite">
            {saveState.message}
          </p>
        ) : null}
      </form>

      <form action={testAction}>
        <button type="submit" disabled={isTesting}>
          {labels.testButton}
        </button>
        {testState?.message ? (
          <p role="status" aria-live="polite">
            {testState.message}
          </p>
        ) : null}
        <p className="hint">{labels.webhookVerifiedNote}</p>
      </form>
    </div>
  );
}