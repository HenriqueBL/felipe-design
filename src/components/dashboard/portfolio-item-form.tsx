"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  deletePortfolioItemAction,
  movePortfolioItemAction,
  setPortfolioFeaturedAction,
  clearPortfolioFeaturedAction,
  togglePortfolioPublishAction,
  updatePortfolioItemAction,
} from "@/app/[locale]/dashboard/portfolio/actions";
import type { PortfolioActionResult } from "@/app/[locale]/dashboard/portfolio/actions";
import type { PortfolioItemRow } from "@/types/database";

export interface PortfolioItemLabels {
  itemTitle: string;
  description: string;
  image: string;
  imageHint: string;
  sortOrder: string;
  published: string;
  featured: string;
  save: string;
  saving: string;
  error: string;
  publish: string;
  unpublish: string;
  setFeatured: string;
  removeFeatured: string;
  moveUp: string;
  moveDown: string;
  delete: string;
  deleteConfirm: string;
}

function StatusSpan({ state }: { state: PortfolioActionResult | null }) {
  if (!state) {
    return null;
  }
  return state.success ? (
    <span className="form-status ok"> {state.message}</span>
  ) : (
    <span className="form-status err"> {state.message}</span>
  );
}

export default function PortfolioItemForm({
  locale,
  item,
  imageUrl,
  labels,
}: {
  locale: string;
  item: PortfolioItemRow;
  imageUrl: string | null;
  labels: PortfolioItemLabels;
}) {
  const [updateState, updateAction, updatePending] = useActionState<
    PortfolioActionResult | null,
    FormData
  >(updatePortfolioItemAction.bind(null, locale), null);
  const [publishState, publishAction, publishPending] = useActionState<
    PortfolioActionResult | null,
    FormData
  >(togglePortfolioPublishAction.bind(null, locale), null);
  const [featuredState, featuredAction, featuredPending] = useActionState<
    PortfolioActionResult | null,
    FormData
  >(setPortfolioFeaturedAction.bind(null, locale), null);
  const [clearFeaturedState, clearFeaturedAction, clearFeaturedPending] =
    useActionState<PortfolioActionResult | null, FormData>(
      clearPortfolioFeaturedAction.bind(null, locale),
      null,
    );
  const [deleteState, deleteAction, deletePending] = useActionState<
    PortfolioActionResult | null,
    FormData
  >(deletePortfolioItemAction.bind(null, locale), null);
  const [moveUpState, moveUpAction, moveUpPending] = useActionState<
    PortfolioActionResult | null,
    FormData
  >(movePortfolioItemAction.bind(null, locale), null);
  const [moveDownState, moveDownAction, moveDownPending] = useActionState<
    PortfolioActionResult | null,
    FormData
  >(movePortfolioItemAction.bind(null, locale), null);

  return (
    <section className="panel portfolio-item" data-id={item.id}>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={item.title}
          width={160}
          height={120}
          className="portfolio-thumb"
          unoptimized
        />
      ) : null}
      <h2>{item.title}</h2>
      <p className="note">
        {labels.published}: {item.published ? "✓" : "✗"} — {labels.featured}:{" "}
        {item.featured ? "✓" : "✗"} — {labels.sortOrder}: {item.sort_order}
      </p>

      <form action={updateAction}>
        <input type="hidden" name="id" value={item.id} />
        <label htmlFor={"portfolio-title-" + item.id}>{labels.itemTitle}</label>
        <input
          id={"portfolio-title-" + item.id}
          name="title"
          defaultValue={item.title}
          required
          maxLength={200}
        />
        <label htmlFor={"portfolio-description-" + item.id}>{labels.description}</label>
        <textarea
          id={"portfolio-description-" + item.id}
          name="description"
          defaultValue={item.description ?? ""}
          maxLength={2000}
          rows={3}
        />
        <label htmlFor={"portfolio-image-" + item.id}>{labels.image}</label>
        <input
          id={"portfolio-image-" + item.id}
          name="image"
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          aria-describedby={"portfolio-image-hint-" + item.id}
        />
        <p className="note" id={"portfolio-image-hint-" + item.id}>{labels.imageHint}</p>
        <label htmlFor={"portfolio-sort-" + item.id}>{labels.sortOrder}</label>
        <input
          id={"portfolio-sort-" + item.id}
          name="sortOrder"
          type="number"
          min={0}
          max={100000}
          defaultValue={item.sort_order}
        />
        <button type="submit" className="btn btn-primary" disabled={updatePending}>
          {updatePending ? labels.saving : labels.save}
        </button>
        <StatusSpan state={updateState} />
      </form>

      <div className="portfolio-actions">
        <form action={publishAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="published" value={item.published ? "false" : "true"} />
          <button type="submit" className="btn" disabled={publishPending}>
            {item.published ? labels.unpublish : labels.publish}
          </button>
        </form>
        <StatusSpan state={publishState} />

        {item.featured ? (
          <form action={clearFeaturedAction}>
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className="btn" disabled={clearFeaturedPending}>
              {labels.removeFeatured}
            </button>
          </form>
        ) : (
          <form action={featuredAction}>
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className="btn" disabled={featuredPending}>
              {labels.setFeatured}
            </button>
          </form>
        )}
        <StatusSpan state={featuredState ?? clearFeaturedState} />

        <form action={moveUpAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="sortOrder" value={Math.max(0, item.sort_order - 1)} />
          <button type="submit" className="btn" disabled={moveUpPending}>
            {labels.moveUp}
          </button>
        </form>
        <form action={moveDownAction}>
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="sortOrder" value={item.sort_order + 1} />
          <button type="submit" className="btn" disabled={moveDownPending}>
            {labels.moveDown}
          </button>
        </form>
        <StatusSpan state={moveUpState ?? moveDownState} />

        <form
          action={deleteAction}
          onSubmit={(event) => {
            if (!window.confirm(labels.deleteConfirm)) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" className="btn btn-danger" disabled={deletePending}>
            {labels.delete}
          </button>
        </form>
        <StatusSpan state={deleteState} />
      </div>
    </section>
  );
}