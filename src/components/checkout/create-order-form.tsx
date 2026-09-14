"use client";

import { useActionState } from "react";
import { createOrderAction, type CreateOrderResult } from "@/app/[locale]/checkout/actions";
import type { Locale } from "@/lib/i18n/config";
import type { Currency } from "@/types/database";

interface CreateOrderFormLabels {
  createOrder: string;
  creating: string;
  invalidSelection: string;
  loginRequired: string;
  planUnavailable: string;
  error: string;
}

interface CreateOrderFormProps {
  locale: Locale;
  labels: CreateOrderFormLabels;
  planId: string;
  quantity: number;
  currency: Currency;
  idempotencyKey: string;
}

function messageForCode(code: string | undefined, labels: CreateOrderFormLabels): string {
  if (code === "PLAN_NOT_FOUND" || code === "PRICE_NOT_FOUND") {
    return labels.planUnavailable;
  }
  if (code === "INVALID_QUANTITY" || code === "INVALID_INPUT") {
    return labels.invalidSelection;
  }
  if (code === "NOT_AUTHENTICATED") {
    return labels.loginRequired;
  }
  return labels.error;
}

export default function CreateOrderForm({
  locale,
  labels,
  planId,
  quantity,
  currency,
  idempotencyKey,
}: CreateOrderFormProps) {
  const [state, formAction, isPending] = useActionState<CreateOrderResult | null, FormData>(
    createOrderAction.bind(null, locale),
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="quantity" value={quantity} />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? labels.creating : labels.createOrder}
      </button>
      {state !== null && state.success === false ? (
        <p className="form-status err">{messageForCode(state.errorCode, labels)}</p>
      ) : null}
    </form>
  );
}
