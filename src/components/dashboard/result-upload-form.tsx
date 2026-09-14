"use client";

import { useActionState, useState } from "react";
import { uploadOrderResultsAction } from "@/app/[locale]/dashboard/actions";
import type { ActionResult } from "@/app/[locale]/dashboard/actions";

interface ResultUploadLabels {
  title: string;
  hint: string;
  button: string;
  uploading: string;
  error: string;
}

export default function ResultUploadForm({
  locale,
  orderId,
  labels,
}: {
  locale: string;
  orderId: string;
  labels: ResultUploadLabels;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult | null, FormData>(
    uploadOrderResultsAction.bind(null, locale),
    null,
  );
  const [selection, setSelection] = useState("");

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <h3>{labels.title}</h3>
      <p className="note">{labels.hint}</p>
      <input
        type="file"
        name="files"
        multiple
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const names = Array.from(event.target.files ?? []).map((file) => file.name);
          setSelection(names.length > 0 ? names.join(", ") : "");
        }}
      />
      {selection !== "" ? <p className="note">{selection}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={isPending}>
        {isPending ? labels.uploading : labels.button}
      </button>
      {state?.success === true ? (
        <span className="form-status ok"> {state.message}</span>
      ) : null}
      {state?.success === false ? (
        <span className="form-status err"> {state.message ?? labels.error}</span>
      ) : null}
    </form>
  );
}
