"use client";

import { useEffect, useRef } from "react";
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
  idempotencyKey: string;
  onSuccess?: (result: CreateOrderResult) => void;
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
  idempotencyKey,
  onSuccess,
}: CreateCartOrderFormProps) {
  const [state, formAction, isPending] = useActionState<
    CreateOrderResult | null,
    FormData
  >(createCartOrderAction.bind(null, locale), null);

  // Track whether we've already fired the success callback for this result
  // to avoid double-firing on re-renders.
  const handledRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      state !== null &&
      state.success === true &&
      state.orderId &&
      handledRef.current !== state.orderId
    ) {
      handledRef.current = state.orderId;
      onSuccess?.(state);
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction}>
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(items)}
      />
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