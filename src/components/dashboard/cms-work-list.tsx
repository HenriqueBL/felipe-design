"use client";

import Image from "next/image";
import { useTransition } from "react";
import type { PortfolioWorkSummary } from "@/services/portfolio-cms";
import {
  setFeaturedAction,
  clearFeaturedAction,
  reorderWorksAction,
  deleteWorkAction,
} from "@/app/[locale]/dashboard/portfolio/cms-actions";

interface WorkWithUrl extends PortfolioWorkSummary {
  coverUrl: string | null;
}

interface Labels {
  cmsSetFeatured: string;
  cmsClearFeatured: string;
  cmsDelete: string;
  cmsDeleteConfirm: string;
  cmsMoveUp: string;
  cmsMoveDown: string;
  cmsEditWork: string;
  cmsFeatured: string;
  cmsPublished: string;
  cmsMediaCount: string;
  cmsEmpty: string;
  cmsReorderFailed: string;
  cmsFeaturedFailed: string;
  cmsDeleteFailed: string;
}

export default function CmsWorkList({
  locale,
  works,
  labels,
}: {
  locale: string;
  works: WorkWithUrl[];
  labels: Labels;
}) {
  const [isPending, startTransition] = useTransition();

  if (works.length === 0) {
    return <p className="note">{labels.cmsEmpty}</p>;
  }

  function handleSetFeatured(workId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("workId", workId);
      const result = await setFeaturedAction(locale, null, fd);
      if (!result.success) {
        alert(labels.cmsFeaturedFailed);
      }
    });
  }

  function handleClearFeatured(workId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("workId", workId);
      const result = await clearFeaturedAction(locale, null, fd);
      if (!result.success) {
        alert(labels.cmsFeaturedFailed);
      }
    });
  }

  function handleDelete(workId: string) {
    if (!confirm(labels.cmsDeleteConfirm)) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("workId", workId);
      const result = await deleteWorkAction(locale, null, fd);
      if (!result.success) {
        alert(labels.cmsDeleteFailed);
      }
    });
  }

  async function handleMove(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= works.length) return;
    const newOrder = works.map((w) => w.id);
    const fromId = newOrder[index];
    const toId = newOrder[newIndex];
    if (!fromId || !toId) return;
    newOrder[index] = toId;
    newOrder[newIndex] = fromId;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("workIds", JSON.stringify(newOrder));
      const result = await reorderWorksAction(locale, null, fd);
      if (!result.success) {
        alert(labels.cmsReorderFailed);
      }
    });
  }

  return (
    <div className="cms-work-grid">
      {works.map((work, index) => (
        <article
          key={work.id}
          data-work-id={work.id}
          className={`cms-work-card${work.featured ? " featured" : ""}`}
        >
          {work.coverUrl ? (
            <Image
              src={work.coverUrl}
              alt={work.title}
              className="cms-work-thumb"
              width={600}
              height={450}
              unoptimized
            />
          ) : (
            <div className="cms-work-thumb" />
          )}
          <div className="cms-work-body">
            <h3 className="cms-work-title">{work.title}</h3>
            <div className="cms-work-meta">
              {work.featured && (
                <span className="cms-badge featured">{labels.cmsFeatured}</span>
              )}
              <span
                className={`cms-badge ${work.published ? "published" : "draft"}`}
              >
                {work.published ? labels.cmsPublished : "Draft"}
              </span>
              <span className="cms-badge media-count">
                {labels.cmsMediaCount.replace("{count}", String(work.mediaCount))}
              </span>
            </div>
            <div className="cms-work-actions">
              <a
                href={`/${locale}/dashboard/portfolio?edit=${work.id}`}
                className="btn-sm btn-secondary"
              >
                {labels.cmsEditWork}
              </a>
              {index > 0 && (
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  disabled={isPending}
                  onClick={() => handleMove(index, -1)}
                  aria-label={labels.cmsMoveUp}
                >
                  ↑
                </button>
              )}
              {index < works.length - 1 && (
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  disabled={isPending}
                  onClick={() => handleMove(index, 1)}
                  aria-label={labels.cmsMoveDown}
                >
                  ↓
                </button>
              )}
              {!work.featured ? (
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  data-testid="set-featured"
                  aria-label={labels.cmsSetFeatured}
                  disabled={isPending}
                  onClick={() => handleSetFeatured(work.id)}
                >
                  ★
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-sm btn-secondary"
                  data-testid="clear-featured"
                  aria-label={labels.cmsClearFeatured}
                  disabled={isPending}
                  onClick={() => handleClearFeatured(work.id)}
                >
                  ☆
                </button>
              )}
              <button
                type="button"
                className="btn-sm btn-danger"
                disabled={isPending}
                onClick={() => handleDelete(work.id)}
              >
                ✕
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}