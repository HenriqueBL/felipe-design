"use client";

import { useActionState } from "react";
import { requestRevisionAction, type RevisionResult } from "@/app/[locale]/account/actions";

interface RevisionLabels {
  title: string;
  description: string;
  notesLabel: string;
  notesPlaceholder: string;
  submit: string;
  error: string;
}

export default function RevisionForm({
  locale,
  orderId,
  labels,
}: {
  locale: string;
  orderId: string;
  labels: RevisionLabels;
}) {
  const [state, formAction, isPending] = useActionState<RevisionResult | null, FormData>(
    requestRevisionAction.bind(null, locale),
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <h3>{labels.title}</h3>
      <p className="note">{labels.description}</p>
      <div className="form-group">
        <label htmlFor="revision-notes">{labels.notesLabel}</label>
        <textarea
          id="revision-notes"
          name="notes"
          rows={4}
          maxLength={2000}
          placeholder={labels.notesPlaceholder}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {labels.submit}
      </button>
      {state?.success === false && <p className="form-status err">{labels.error}</p>}
    </form>
  );
}
