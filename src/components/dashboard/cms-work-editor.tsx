"use client";

import Image from "next/image";
import { useState, useTransition, useRef, useEffect } from "react";
import type { FocalPoint } from "@/types/database";
import { VALID_FOCAL_POINTS, MAX_MEDIA_PER_WORK } from "@/domain/portfolio";
import { portfolioPublicUrl } from "@/lib/portfolio-url";
import {
  createWorkAction,
  updateWorkAction,
  addMediaAction,
  replaceMediaAction,
  removeMediaAction,
  reorderMediaAction,
  setHeroMediaAction,
  setFocalPointAction,
} from "@/app/[locale]/dashboard/portfolio/cms-actions";
import type { CmsActionResult } from "@/app/[locale]/dashboard/portfolio/cms-actions";

interface MediaItem {
  id: string;
  storagePath: string;
  position: number;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  altText: string | null;
  focalPoint: FocalPoint;
}

interface Labels {
  cmsNewWork: string;
  cmsEditWork: string;
  cmsWorkTitle: string;
  cmsWorkDescription: string;
  cmsPublished: string;
  cmsFeatured: string;
  cmsSetFeatured: string;
  cmsClearFeatured: string;
  cmsHeroImage: string;
  cmsSetHero: string;
  cmsFocalPoint: string;
  cmsGalleryPreview: string;
  cmsHeroPreview: string;
  cmsMediaCount: string;
  cmsAngle: string;
  cmsAddImages: string;
  cmsUploadHint: string;
  cmsReplace: string;
  cmsRemove: string;
  cmsMoveUp: string;
  cmsMoveDown: string;
  cmsSave: string;
  cmsSaving: string;
  cmsSaved: string;
  cmsDelete: string;
  cmsDeleteConfirm: string;
  cmsCancel: string;
  cmsEmpty: string;
  cmsLoading: string;
  cmsUploadProgress: string;
  cmsUploadError: string;
  cmsCreateFailed: string;
  cmsUpdateFailed: string;
  cmsDeleteFailed: string;
  cmsReorderFailed: string;
  cmsFeaturedFailed: string;
  cmsHeroFailed: string;
  cmsFocalPointFailed: string;
  cmsMediaAddFailed: string;
  cmsMediaReplaceFailed: string;
  cmsMediaRemoveFailed: string;
  cmsLastMediaWarning: string;
  cmsMaxMediaReached: string;
  cmsDragToReorder: string;
  cmsPreviewLayout1: string;
  cmsPreviewLayout2: string;
  cmsPreviewLayout3: string;
  cmsFocalPointTopLeft: string;
  cmsFocalPointTopCenter: string;
  cmsFocalPointTopRight: string;
  cmsFocalPointCenterLeft: string;
  cmsFocalPointCenter: string;
  cmsFocalPointCenterRight: string;
  cmsFocalPointBottomLeft: string;
  cmsFocalPointBottomCenter: string;
  cmsFocalPointBottomRight: string;
}

const FOCAL_LABELS: Record<FocalPoint, keyof Labels> = {
  "top-left": "cmsFocalPointTopLeft",
  "top-center": "cmsFocalPointTopCenter",
  "top-right": "cmsFocalPointTopRight",
  "center-left": "cmsFocalPointCenterLeft",
  center: "cmsFocalPointCenter",
  "center-right": "cmsFocalPointCenterRight",
  "bottom-left": "cmsFocalPointBottomLeft",
  "bottom-center": "cmsFocalPointBottomCenter",
  "bottom-right": "cmsFocalPointBottomRight",
};

export default function CmsWorkEditor({
  locale,
  workId,
  labels,
  supabaseUrl,
}: {
  locale: string;
  workId: string | null;
  labels: Labels;
  supabaseUrl: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(true);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [heroMediaId, setHeroMediaId] = useState<string | null>(null);
  const [focalPoint, setFocalPoint] = useState<FocalPoint>("center");
  const [uploading, setUploading] = useState(false);
  const [replaceMediaId, setReplaceMediaId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceFileInputRef = useRef<HTMLInputElement>(null);

  const isCreating = !workId;

  /** Fetch current work state from API and update React state.
   *  Used for initial load and after mutations instead of window.location.reload(). */
  async function refreshWork() {
    if (!workId) return;
    try {
      const res = await fetch(`/api/portfolio-work?id=${workId}`);
      if (res.ok) {
        const data = await res.json();
        setTitle(data.title);
        setDescription(data.description ?? "");
        setPublished(data.published);
        setMedia(data.media ?? []);
        setHeroMediaId(data.heroMediaId);
        setFocalPoint(data.focalPoint ?? "center");
      } else {
        setStatus(labels.cmsUpdateFailed);
      }
    } catch {
      setStatus(labels.cmsUpdateFailed);
    }
  }

  // Load existing work data when editing
  useEffect(() => {
    if (workId) {
      startTransition(() => refreshWork());
    }
  }, [workId]);

  function getMediaUrl(storagePath: string): string {
    return portfolioPublicUrl(supabaseUrl, storagePath);
  }

  function handleFocalPointChange(fp: FocalPoint) {
    setFocalPoint(fp);
    if (!isCreating && workId) {
      startTransition(async () => {
        const fd = new FormData();
        fd.append("workId", workId);
        fd.append("focalPoint", fp);
        const result = await setFocalPointAction(locale, null, fd);
        if (!result.success) {
          setStatus(labels.cmsFocalPointFailed);
        } else {
          setStatus(labels.cmsSaved);
        }
      });
    }
  }

  function handleSetHero(mediaId: string) {
    if (!workId) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("workId", workId);
      fd.append("mediaId", mediaId);
      const result = await setHeroMediaAction(locale, null, fd);
      if (!result.success) {
        setStatus(labels.cmsHeroFailed);
      } else {
        setHeroMediaId(mediaId);
        setStatus(labels.cmsSaved);
      }
    });
  }

  function handleRemoveMedia(mediaId: string) {
    if (media.length <= 1) {
      alert(labels.cmsLastMediaWarning);
      return;
    }
    if (!workId) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("mediaId", mediaId);
      const result = await removeMediaAction(locale, null, fd);
      if (!result.success) {
        setStatus(labels.cmsMediaRemoveFailed);
      } else {
        await refreshWork();
        setStatus(labels.cmsSaved);
      }
    });
  }

  function handleReplaceMedia(mediaId: string) {
    if (!workId || !replaceFileInputRef.current) return;
    setReplaceMediaId(mediaId);
    replaceFileInputRef.current.value = "";
    replaceFileInputRef.current.click();
  }

  async function handleReplaceMediaFile(files: FileList | null) {
    if (!workId || !replaceMediaId || !files || files.length === 0) return;
    const file = files[0]!;
    setUploading(true);
    const fd = new FormData();
    fd.append("mediaId", replaceMediaId);
    fd.append("media", file);
    const result = await replaceMediaAction(locale, null, fd);
    setUploading(false);
    if (!result.success) {
      setStatus(labels.cmsMediaReplaceFailed);
    } else {
      await refreshWork();
      setStatus(labels.cmsSaved);
    }
    setReplaceMediaId(null);
  }

  function handleAddMedia() {
    if (!workId || !fileInputRef.current) return;
    if (media.length >= MAX_MEDIA_PER_WORK) {
      alert(labels.cmsMaxMediaReached);
      return;
    }
    // Use the persistent hidden file input instead of creating a dynamic one.
    // This makes the file chooser reliably interceptable by Playwright tests
    // and avoids race conditions with waitForEvent("filechooser").
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }

  async function handleAddMediaFiles(files: FileList | null) {
    if (!workId || !files || files.length === 0) return;
    const slotsAvailable = MAX_MEDIA_PER_WORK - media.length;
    const filesToAdd = Array.from(files).slice(0, slotsAvailable);
    if (filesToAdd.length === 0) return;
    setUploading(true);
    for (const file of filesToAdd) {
      const fd = new FormData();
      fd.append("workId", workId);
      fd.append("media", file);
      const result = await addMediaAction(locale, null, fd);
      if (!result.success) {
        setStatus(labels.cmsMediaAddFailed);
        setUploading(false);
        return;
      }
    }
    setUploading(false);
    await refreshWork();
    setStatus(labels.cmsSaved);
  }

  async function handleMoveMedia(index: number, direction: -1 | 1) {
    if (!workId) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= media.length) return;
    const sorted = [...media].sort((a, b) => a.position - b.position);
    const newOrder = sorted.map((m) => m.id);
    const fromId = newOrder[index];
    const toId = newOrder[newIndex];
    if (!fromId || !toId) return;
    newOrder[index] = toId;
    newOrder[newIndex] = fromId;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("workId", workId);
      fd.append("mediaIds", JSON.stringify(newOrder));
      const result = await reorderMediaAction(locale, null, fd);
      if (!result.success) {
        setStatus(labels.cmsReorderFailed);
      } else {
        await refreshWork();
        setStatus(labels.cmsSaved);
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("description", description);
      fd.append("published", String(published));

      let result: CmsActionResult;
      if (isCreating) {
        // For creation, we need at least one file — but files are uploaded
        // separately after creation in this flow. Show error if no media yet.
        // Actually, the create action expects media_N fields.
        // Since we can't easily attach files from state, redirect to a
        // simpler flow: create with title first, then add media.
        // For now, require at least one file input.
        if (fileInputRef.current?.files?.length) {
          for (let i = 0; i < fileInputRef.current.files.length; i++) {
            const file = fileInputRef.current.files.item(i);
            if (file) {
              fd.append(`media_${i}`, file);
            }
          }
        } else {
          setStatus(labels.cmsUploadError);
          return;
        }
        result = await createWorkAction(locale, null, fd);
      } else {
        fd.append("id", workId!);
        result = await updateWorkAction(locale, null, fd);
      }

      if (!result.success) {
        setStatus(isCreating ? labels.cmsCreateFailed : labels.cmsUpdateFailed);
      } else {
        if (!isCreating) {
          await refreshWork();
        }
        setStatus(labels.cmsSaved);
        if (isCreating && result.data?.id) {
          window.location.href = `/${locale}/dashboard/portfolio?edit=${result.data.id}`;
        }
      }
    });
  }

  const sortedMedia = [...media].sort((a, b) => a.position - b.position);
  const layoutClass =
    sortedMedia.length === 1
      ? "layout-1"
      : sortedMedia.length === 2
        ? "layout-2"
        : "layout-3";

  return (
    <div className="cms-editor">
      <div className="cms-editor-header">
        <h2 className="cms-editor-title">
          {isCreating ? labels.cmsNewWork : labels.cmsEditWork}
        </h2>
        {status && (
          <span className="note" role="status">
            {status}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="cms-title" style={{ display: "block", marginBottom: 4 }}>
            {labels.cmsWorkTitle}
          </label>
          <input
            id="cms-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="cms-desc" style={{ display: "block", marginBottom: 4 }}>
            {labels.cmsWorkDescription}
          </label>
          <textarea
            id="cms-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
        </div>

        <div style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
            />
            {labels.cmsPublished}
          </label>
        </div>

        {/* Media Section */}
        {!isCreating && (
          <>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              {labels.cmsMediaCount.replace("{count}", String(sortedMedia.length))}
            </div>

            <div className="cms-media-grid">
              {sortedMedia.map((m, idx) => (
                <div
                  key={m.id}
                  data-media-id={m.id}
                  className={`cms-media-card${heroMediaId === m.id ? " hero" : ""}`}
                >
                  <Image
                    src={getMediaUrl(m.storagePath)}
                    alt={m.altText ?? labels.cmsAngle.replace("{n}", String(idx + 1))}
                    className="cms-media-img"
                    width={400}
                    height={400}
                    unoptimized
                  />
                  <div className="cms-media-label">
                    <span>
                      {labels.cmsAngle.replace("{n}", String(idx + 1))}
                      {heroMediaId === m.id && ` — ${labels.cmsHeroImage}`}
                    </span>
                    <div className="cms-media-actions">
                      {heroMediaId !== m.id && (
                        <button
                          type="button"
                          data-testid="set-hero"
                          aria-label={labels.cmsSetHero}
                          onClick={() => handleSetHero(m.id)}
                          disabled={isPending}
                          title={labels.cmsSetHero}
                        >
                          ★
                        </button>
                      )}
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => handleMoveMedia(idx, -1)}
                          disabled={isPending}
                          aria-label={labels.cmsMoveUp}
                        >
                          ↑
                        </button>
                      )}
                      {idx < sortedMedia.length - 1 && (
                        <button
                          type="button"
                          onClick={() => handleMoveMedia(idx, 1)}
                          disabled={isPending}
                          aria-label={labels.cmsMoveDown}
                        >
                          ↓
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="replace-media"
                        aria-label={labels.cmsReplace}
                        onClick={() => handleReplaceMedia(m.id)}
                        disabled={isPending || uploading}
                      >
                        {labels.cmsReplace}
                      </button>
                      <button
                        type="button"
                        data-testid="remove-media"
                        aria-label={labels.cmsRemove}
                        onClick={() => handleRemoveMedia(m.id)}
                        disabled={isPending || sortedMedia.length <= 1}
                      >
                        {labels.cmsRemove}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {sortedMedia.length < MAX_MEDIA_PER_WORK && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleAddMedia}
                disabled={isPending || uploading}
                style={{ marginBottom: 20 }}
              >
                {uploading ? labels.cmsUploadProgress : labels.cmsAddImages}
              </button>
            )}
            <p className="note" style={{ marginBottom: 20 }}>
              {labels.cmsUploadHint}
            </p>

            {/* Hidden persistent input for Replace Media */}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              ref={replaceFileInputRef}
              onChange={(e) => handleReplaceMediaFile(e.target.files)}
              style={{ display: "none" }}
            />

            {/* Focal Point Selector */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>{labels.cmsFocalPoint}</div>
              <div className="cms-focal-grid" role="radiogroup" aria-label={labels.cmsFocalPoint}>
                {VALID_FOCAL_POINTS.map((fp) => (
                  <button
                    key={fp}
                    type="button"
                    className={`cms-focal-cell${focalPoint === fp ? " active" : ""}`}
                    onClick={() => handleFocalPointChange(fp)}
                    role="radio"
                    aria-checked={focalPoint === fp}
                    aria-label={labels[FOCAL_LABELS[fp]]}
                    title={labels[FOCAL_LABELS[fp]]}
                  />
                ))}
              </div>
            </div>

            {/* Gallery Preview */}
            <div className="cms-preview-section">
              <div className="cms-preview-label">{labels.cmsGalleryPreview}</div>
              <div className={`cms-gallery-preview ${layoutClass}`}>
                {sortedMedia.map((m, idx) => (
                  <Image
                    key={m.id}
                    src={getMediaUrl(m.storagePath)}
                    alt={labels.cmsAngle.replace("{n}", String(idx + 1))}
                    className={idx === 0 ? "angle-1" : undefined}
                    width={600}
                    height={400}
                    unoptimized
                    style={{ objectFit: "contain" }}
                  />
                ))}
              </div>
            </div>

            {/* Hero Preview */}
            {heroMediaId && (
              <div className="cms-preview-section">
                <div className="cms-preview-label">{labels.cmsHeroPreview}</div>
                {(() => {
                  const heroMedia = sortedMedia.find((m) => m.id === heroMediaId);
                  if (!heroMedia) return null;
                  const orientation =
                    heroMedia.width && heroMedia.height
                      ? heroMedia.width > heroMedia.height
                        ? "landscape"
                        : heroMedia.width < heroMedia.height
                          ? "portrait"
                          : "square"
                      : "landscape";
                  const objectPosition =
                    focalPoint === "top-left"
                      ? "left top"
                      : focalPoint === "top-center"
                        ? "center top"
                        : focalPoint === "top-right"
                          ? "right top"
                          : focalPoint === "center-left"
                            ? "left center"
                            : focalPoint === "center-right"
                              ? "right center"
                              : focalPoint === "bottom-left"
                                ? "left bottom"
                                : focalPoint === "bottom-center"
                                  ? "center bottom"
                                  : focalPoint === "bottom-right"
                                    ? "right bottom"
                                    : "center center";
                  return (
                    <div className={`cms-hero-preview ${orientation}`}>
                      <Image
                        src={getMediaUrl(heroMedia.storagePath)}
                        alt={labels.cmsHeroImage}
                        fill
                        unoptimized
                        style={{ objectPosition }}
                      />
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* Persistent hidden file input used by both create and edit modes.
            In create mode it is visible; in edit mode it stays hidden and is
            triggered by the "Add images" button via handleAddMedia().
            This avoids creating dynamic inputs that race with Playwright's
            waitForEvent("filechooser"). */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(e) => {
            if (isCreating) return; // create mode handles files via form submit
            handleAddMediaFiles(e.target.files);
            e.target.value = "";
          }}
          data-testid="add-media-hidden-input"
          style={
            isCreating
              ? { display: "block" }
              : {
                  position: "fixed",
                  left: "-9999px",
                  top: 0,
                  width: "1px",
                  height: "1px",
                  opacity: 0.01,
                }
          }
          aria-hidden={!isCreating}
        />
        {isCreating && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>
              {labels.cmsAddImages}
            </label>
            <p className="note">{labels.cmsUploadHint}</p>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isPending || uploading}
          >
            {isPending ? labels.cmsSaving : labels.cmsSave}
          </button>
          <a
            href={`/${locale}/dashboard/portfolio`}
            className="btn btn-secondary"
          >
            {labels.cmsCancel}
          </a>
        </div>
      </form>
    </div>
  );
}