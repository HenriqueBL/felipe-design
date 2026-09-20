"use client";

import { useActionState } from "react";
import {
  createCartOrderAction,
  type CreateOrderResult,
} from "@/app/[locale]/checkout/actions";
import type { Locale } from "@/lib/i18n/config";
import type { Currency } from "@/types/database";

interface CreateCartOrderFormLabels {
  createCartOrder: string;
  creatingCartOrder: string;
  invalidSelection: string;
  loginRequired: string;
  planUnavailable: string;
  error: string;
}

interface CartOrderItemIntent {
  planId: string;
  quantity: number;
}

interface CreateCartOrderFormProps {
  locale: Locale;
  labels: CreateCartOrderFormLabels;
  items: CartOrderItemIntent[];
  currency: Currency;
  idempotencyKey: string;
}

function messageForCode(
  code: string | undefined,
  labels: CreateCartOrderFormLabels,
): string {
  if (code === "PLAN_NOT_FOUND" || code === "PRICE_NOT_FOUND") {
    return labels.planUnavailable;
  }
  if (code === "INVALID_ITEMS" || code === "INVALID_INPUT") {
    return labels.invalidSelection;
  }
  if (code === "NOT_AUTHENTICATED") {
    return labels.loginRequired;
  }
  return labels.error;
}

export default function CreateCartOrderForm({
  locale,
  labels,
  items,
  currency,
  idempotencyKey,
}: CreateCartOrderFormProps) {
  const [state, formAction, isPending] = useActionState<
    CreateOrderResult | null,
    FormData
  >(createCartOrderAction.bind(null, locale), null);

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(items)}
      />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? labels.creatingCartOrder : labels.createCartOrder}
      </button>
      {state !== null && state.success === false ? (
        <p className="form-status err">{messageForCode(state.errorCode, labels)}</p>
      ) : null}
    </form>
  );
}