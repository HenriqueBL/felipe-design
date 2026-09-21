"use client";

import { useActionState, useState } from "react";
import { createPortfolioItemAction } from "@/app/[locale]/dashboard/portfolio/actions";
import type { PortfolioActionResult } from "@/app/[locale]/dashboard/portfolio/actions";
import { portfolioActionMessage, type PortfolioActionLabels } from "@/lib/portfolio-action-message";

interface CreateLabels extends PortfolioActionLabels {
  title: string;
  itemTitle: string;
  description: string;
  image: string;
  imageHint: string;
  sortOrder: string;
  published: string;
  button: string;
  pending: string;
}

export default function PortfolioCreateForm({
  locale,
  labels,
}: {
  locale: string;
  labels: CreateLabels;
}) {
  const [state, formAction, isPending] = useActionState<PortfolioActionResult | null, FormData>(
    createPortfolioItemAction.bind(null, locale),
    null,
  );
  const [selection, setSelection] = useState("");

  return (
    <section className="panel">
      <h2>{labels.title}</h2>
      <form action={formAction}>
        <label htmlFor="portfolio-new-title">{labels.itemTitle}</label>
        <input id="portfolio-new-title" name="title" required maxLength={200} />

        <label htmlFor="portfolio-new-description">{labels.description}</label>
        <textarea id="portfolio-new-description" name="description" maxLength={2000} rows={3} />

        <label htmlFor="portfolio-new-image">{labels.image}</label>
        <input
          id="portfolio-new-image"
          name="image"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          required
          aria-describedby="portfolio-new-image-hint"
          onChange={(event) => setSelection(event.target.files?.[0]?.name ?? "")}
        />
        <p className="note" id="portfolio-new-image-hint">
          {labels.imageHint}
          {selection !== "" ? " — " + selection : ""}
        </p>

        <label htmlFor="portfolio-new-sort">{labels.sortOrder}</label>
        <input id="portfolio-new-sort" name="sortOrder" type="number" min={0} max={100000} defaultValue={0} />

        <label className="check-label">
          <input type="checkbox" name="published" />
          {labels.published}
        </label>

        <button type="submit" className="btn btn-primary" disabled={isPending}>
          {isPending ? labels.pending : labels.button}
        </button>
        {state?.code ? (
          <span className={`form-status ${state.success ? "ok" : "err"}`}>
            {" "}{portfolioActionMessage(state.code, labels) ?? (state.success ? labels.created : labels.forbidden)}
          </span>
        ) : null}
      </form>
    </section>
  );
}