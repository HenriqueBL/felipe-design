"use client";

import { useActionState } from "react";
import type { PlanRow } from "@/types/database";
import { setPlanActiveAction, type ActionResult } from "@/app/[locale]/dashboard/actions";

interface PlanToggleLabels {
  activate: string;
  deactivate: string;
  active: string;
  inactive: string;
  saved: string;
  saveError: string;
}

export default function PlanToggleForm({
  locale,
  plan,
  labels,
}: {
  locale: string;
  plan: PlanRow;
  labels: PlanToggleLabels;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    setPlanActiveAction.bind(null, locale),
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="planId" value={plan.id} />
      <input type="hidden" name="active" value={plan.active ? "false" : "true"} />
      <span className={"badge " + (plan.active ? "pending" : "cancelled")}>
        {plan.active ? labels.active : labels.inactive}
      </span>
      <button type="submit" className="btn btn-secondary" disabled={isPending}>
        {plan.active ? labels.deactivate : labels.activate}
      </button>
      {state?.success === true && <span className="form-status ok"> {labels.saved}</span>}
      {state?.success === false && (
        <span className="form-status err"> {state.message ?? labels.saveError}</span>
      )}
    </form>
  );
}
