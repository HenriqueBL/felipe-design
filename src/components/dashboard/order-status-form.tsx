"use client";

import { useActionState } from "react";
import type { OrderRow, OrderStatus } from "@/types/database";
import { setOrderStatusAction, type ActionResult } from "@/app/[locale]/dashboard/actions";
import { orderStatusLabel } from "@/lib/format";

interface OrderStatusLabels {
  changeStatus: string;
  saved: string;
  saveError: string;
}

const STATUS_OPTIONS: OrderStatus[] = ["pending", "in_progress", "completed", "cancelled"];

export default function OrderStatusForm({
  locale,
  order,
  labels,
}: {
  locale: string;
  order: OrderRow;
  labels: OrderStatusLabels;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    setOrderStatusAction.bind(null, locale),
    null,
  );

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="orderId" value={order.id} />
      <div className="form-group">
        <label htmlFor={"status-" + order.id}>{labels.changeStatus}</label>
        <select id={"status-" + order.id} name="status" defaultValue={order.status}>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {orderStatusLabel(status, locale)}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {labels.changeStatus}
      </button>
      {state?.success === true && <span className="form-status ok"> {labels.saved}</span>}
      {state?.success === false && (
        <span className="form-status err"> {state.message ?? labels.saveError}</span>
      )}
    </form>
  );
}
