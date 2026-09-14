"use client";

import { useActionState } from "react";
import {
  simulateMockPaymentAction,
  type SimulatePaymentResult,
} from "@/app/[locale]/account/actions";

interface MockPaymentLabels {
  simulate: string;
  simulating: string;
  disabled: string;
  error: string;
}

export default function MockPaymentForm({
  locale,
  orderId,
  labels,
}: {
  locale: string;
  orderId: string;
  labels: MockPaymentLabels;
}) {
  const [state, formAction, isPending] = useActionState<SimulatePaymentResult | null, FormData>(
    simulateMockPaymentAction.bind(null, locale),
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? labels.simulating : labels.simulate}
      </button>
      {state?.success === false && state.errorCode === "MOCK_DISABLED" && (
        <p className="form-status err">{labels.disabled}</p>
      )}
      {state?.success === false && state.errorCode !== "MOCK_DISABLED" && (
        <p className="form-status err">{labels.error}</p>
      )}
    </form>
  );
}
