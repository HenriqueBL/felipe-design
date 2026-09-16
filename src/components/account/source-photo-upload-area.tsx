"use client";

import { useId, useMemo, useRef, useState, useTransition } from "react";
import { uploadSourcePhotoViaTus, SourcePhotoTusError } from "@/lib/source-photo-tus";
import {
  authorizeSourcePhotoUploadAction,
  deleteSourcePhotoAction,
  finalizeSourcePhotoUploadAction,
  submitSourcePhotosAction,
} from "@/app/[locale]/account/actions";

// =============================================================================
// Source Photo Intake — UI cliente.
//
// Fluxo por arquivo: authorize (Server Action, metadata) -> upload TUS real
// (browser -> Supabase Storage direto) -> progress -> finalize (Server Action)
// -> estado atualizado. Falha de um arquivo nao afeta os demais.
//
// Numeros exibidos (min/max/size) vem do snapshot do pedido — nunca hardcode.
// total_images e OUTPUT e nao e usado aqui.
// =============================================================================

export interface SourcePhotoItem {
  id: string;
  knifeIndex: number;
  filename: string;
  url: string | null;
}

export interface SourcePhotoUploadLabels {
  title: string;
  /** Interpola {min}, {max}. */
  description: (min: number, max: number) => string;
  /** Interpola {size}. */
  maxSizeNote: (size: number) => string;
  knifeLabel: (index: number) => string;
  countLabel: (count: number, max: number) => string;
  add: string;
  choose: string;
  retry: string;
  remove: string;
  removeConfirm: string;
  finishing: string;
  finish: string;
  finishConfirm: string;
  submitted: string;
  states: {
    queued: string;
    uploading: string;
    finalizing: string;
    completed: string;
    failed: string;
  };
  errors: {
    invalidInput: string;
    fileTooLarge: (size: number) => string;
    invalidType: string;
    tooMany: (max: number) => string;
    intakeClosed: string;
    maxPhotos: (max: number) => string;
    minNotMet: string;
    notAuthenticated: string;
    forbidden: string;
    network: string;
    unknown: string;
  };
}

interface UploadJob {
  id: string;
  knifeIndex: number;
  filename: string;
  state: "queued" | "uploading" | "finalizing" | "completed" | "failed";
  progress: number; // 0..1
  errorCode?: string;
}

export interface SourcePhotoUploadAreaProps {
  orderId: string;
  submitted: boolean;
  knifeQuantity: number;
  requiredPerKnife: number;
  maxPerKnife: number;
  maxPhotoSizeMb: number;
  images: SourcePhotoItem[];
  labels: SourcePhotoUploadLabels;
}

const ACCEPT_ATTR = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

type SourcePhotoMime = "image/jpeg" | "image/png" | "image/webp";

/** Type guard: so os MIMEs permitidos pelo snapshot/protocolo. */
function isSourcePhotoMime(value: string): value is SourcePhotoMime {
  return (
    value === "image/jpeg" || value === "image/png" || value === "image/webp"
  );
}

function formatProgress(job: UploadJob, labels: SourcePhotoUploadLabels): string {
  switch (job.state) {
    case "queued":
      return labels.states.queued;
    case "uploading":
      return `${job.filename} — ${Math.floor(job.progress * 100)}%`;
    case "finalizing":
      return labels.states.finalizing;
    case "completed":
      return labels.states.completed;
    case "failed":
      return labels.states.failed;
  }
}

export default function SourcePhotoUploadArea(props: SourcePhotoUploadAreaProps) {
  const {
    orderId,
    submitted,
    knifeQuantity,
    requiredPerKnife,
    maxPerKnife,
    maxPhotoSizeMb,
    images,
    labels,
  } = props;

  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const headingId = useId();

  // Contadores por faca: imagens registradas - removidas na UI + jobs completados.
  const countsByKnife = useMemo(() => {
    const counts: Record<number, number> = {};
    for (let k = 1; k <= knifeQuantity; k++) {
      const registered = images.filter(
        (img) => img.knifeIndex === k && !removedIds.has(img.id),
      ).length;
      const completed = jobs.filter((j) => j.knifeIndex === k && j.state === "completed").length;
      counts[k] = registered + completed;
    }
    return counts;
  }, [images, jobs, knifeQuantity, removedIds]);

  const allKnivesAtMinimum = useMemo(() => {
    for (let k = 1; k <= knifeQuantity; k++) {
      if ((countsByKnife[k] ?? 0) < requiredPerKnife) return false;
    }
    return true;
  }, [countsByKnife, knifeQuantity, requiredPerKnife]);

  const visibleImages = images.filter((img) => !removedIds.has(img.id));

  function updateJob(id: string, patch: Partial<UploadJob>) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }

  function clientValidationError(file: File): string | null {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) {
      return labels.errors.invalidType;
    }
    if (!isSourcePhotoMime(file.type)) {
      return labels.errors.invalidType;
    }
    if (file.size > maxPhotoSizeMb * 1024 * 1024) {
      return labels.errors.fileTooLarge(maxPhotoSizeMb);
    }
    return null;
  }

  function mapErrorCode(code: string): string {
    switch (code) {
      case "FILE_TOO_LARGE":
      case "OBJECT_TOO_LARGE":
        return labels.errors.fileTooLarge(maxPhotoSizeMb);
      case "INVALID_FILE_TYPE":
      case "UNSUPPORTED_MIME":
      case "OBJECT_MIME_INVALID":
        return labels.errors.invalidType;
      case "MAX_PHOTOS_PER_KNIFE_EXCEEDED":
        return labels.errors.tooMany(maxPerKnife);
      case "INTAKE_CLOSED":
        return labels.errors.intakeClosed;
      case "MIN_NOT_MET":
        return labels.errors.minNotMet;
      case "NOT_AUTHENTICATED":
        return labels.errors.notAuthenticated;
      case "FORBIDDEN":
      case "ORDER_NOT_FOUND":
        return labels.errors.forbidden;
      case "INVALID_INPUT":
        return labels.errors.invalidInput;
      default:
        return labels.errors.unknown;
    }
  }

  function mapJobError(error: unknown): string {
    if (error instanceof SourcePhotoTusError) {
      if (error.code === "EXPIRED_SIGNATURE") return labels.errors.network;
      if (error.code === "UNSUPPORTED_MIME") return labels.errors.invalidType;
      return labels.errors.network;
    }
    const code =
      typeof error === "object" && error !== null && "errorCode" in error
        ? String((error as { errorCode?: string }).errorCode)
        : "UNKNOWN";
    return mapErrorCode(code);
  }

  async function processFile(knifeIndex: number, file: File) {
    const jobId = crypto.randomUUID();
    const filename = file.name;
    setJobs((prev) => [
      ...prev,
      { id: jobId, knifeIndex, filename, state: "queued", progress: 0 },
    ]);

    // Guard: MIME invalido nunca inicia authorize/TUS.
    if (!isSourcePhotoMime(file.type)) {
      updateJob(jobId, { state: "failed", errorCode: labels.errors.invalidType });
      return;
    }

    try {
      updateJob(jobId, { state: "uploading" });

      // Phase A — authorize (metadata apenas).
      const auth = await authorizeSourcePhotoUploadAction({
        orderId,
        knifeIndex,
        originalFilename: filename,
        requestedMime: file.type,
      });
      if (!auth.success || !auth.data) {
        throw { errorCode: auth.errorCode ?? "UNKNOWN" };
      }

      // Upload TUS real: browser -> Storage direto.
      await uploadSourcePhotoViaTus({
        file,
        endpoint: auth.data.resumableEndpoint,
        apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        bucket: auth.data.bucket,
        storagePath: auth.data.storagePath,
        signatureToken: auth.data.signatureToken,
        contentType: file.type,
        onProgress: (uploaded, total) => {
          updateJob(jobId, { progress: total > 0 ? uploaded / total : 0 });
        },
      });

      // Phase B — finalize (metadata apenas).
      updateJob(jobId, { state: "finalizing" });
      const final = await finalizeSourcePhotoUploadAction({
        orderId,
        knifeIndex,
        storagePath: auth.data.storagePath,
        originalFilename: filename,
      });
      if (!final.success) {
        throw { errorCode: final.errorCode ?? "UNKNOWN" };
      }
      updateJob(jobId, { state: "completed", progress: 1 });
    } catch (error) {
      updateJob(jobId, { state: "failed", errorCode: mapJobError(error) });
    }
  }

  function onFilesSelected(knifeIndex: number, files: FileList | null) {
    const input = fileInputs.current[knifeIndex];
    if (input) input.value = "";
    if (!files || files.length === 0) return;

    const current = countsByKnife[knifeIndex] ?? 0;
    const remaining = maxPerKnife - current;
    const list = Array.from(files);

    // Nunca iniciar mais uploads que a capacidade restante.
    if (list.length > remaining) {
      const note = document.getElementById(headingId + "-error-" + knifeIndex);
      if (note) {
        note.textContent = labels.errors.tooMany(remaining);
      }
    }
    const accepted = list.slice(0, Math.max(0, remaining));
    for (const file of accepted) {
      const clientError = clientValidationError(file);
      if (clientError) {
        const note = document.getElementById(headingId + "-error-" + knifeIndex);
        if (note) note.textContent = clientError;
        continue;
      }
      void processFile(knifeIndex, file);
    }
  }

  async function onDelete(imageId: string) {
    const confirmed = window.confirm(labels.removeConfirm);
    if (!confirmed) return;
    const result = await deleteSourcePhotoAction({ orderId, imageId });
    if (!result.success) {
      const note = document.getElementById(headingId + "-error");
      if (note) note.textContent = mapErrorCode(result.errorCode ?? "UNKNOWN");
      return;
    }
    // Otimista: remove da UI ate a revalidacao trazer o estado do servidor.
    setRemovedIds((prev) => new Set(prev).add(imageId));
  }

  function onFinish() {
    const confirmed = window.confirm(labels.finishConfirm);
    if (!confirmed) return;
    setSubmitting(true);
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitSourcePhotosAction(orderId);
      setSubmitting(false);
      if (!result.success) {
        setSubmitError(mapErrorCode(result.errorCode ?? "UNKNOWN"));
        return;
      }
      // Estado do servidor e revalidado pela action (read-only pos-submit).
    });
  }

  const busy = jobs.some((j) => j.state !== "completed" && j.state !== "failed");

  return (
    <div className="source-photo-upload" id={headingId}>
      <h3>{labels.title}</h3>
      <p>
        {labels.description(requiredPerKnife, maxPerKnife)}{" "}
        {labels.maxSizeNote(maxPhotoSizeMb)}
      </p>

      {submitted ? (
        <p className="note" role="status">
          {labels.submitted}
        </p>
      ) : null}

      {visibleImages.length > 0 || jobs.length > 0 ? (
        <ul className="source-photo-list">
          {visibleImages.map((img) => (
            <li key={img.id} className="source-photo-item">
              {img.url ? (
                <img
                  src={img.url}
                  alt={img.filename}
                  className="source-photo-thumb"
                  loading="lazy"
                />
              ) : null}
              <span className="filename">{img.filename}</span>
              {!submitted ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void onDelete(img.id)}
                  disabled={busy}
                >
                  {labels.remove}
                </button>
              ) : null}
            </li>
          ))}
          {jobs.map((job) => (
            <li
              key={job.id}
              className={"source-photo-item job-" + job.state}
              aria-label={formatProgress(job, labels)}
            >
              <span className="filename">{formatProgress(job, labels)}</span>
              {job.state === "uploading" ? (
                <progress
                  value={Math.floor(job.progress * 100)}
                  max={100}
                  aria-hidden="true"
                />
              ) : null}
              {job.state === "failed" ? (
                <span className="note error" role="alert">
                  {job.errorCode ?? labels.errors.unknown}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {submitted ? null : (
        <>
          {Array.from({ length: knifeQuantity }, (_, i) => i + 1).map((knifeIndex) => {
            const count = countsByKnife[knifeIndex] ?? 0;
            const capacity = Math.max(0, maxPerKnife - count);
            return (
              <div key={knifeIndex} className="source-photo-knife">
                <h4>
                  {labels.knifeLabel(knifeIndex)} — {labels.countLabel(count, maxPerKnife)}
                </h4>
                {capacity === 0 ? (
                  <p className="note">{labels.errors.tooMany(0)}</p>
                ) : (
                  <div>
                    <label
                      className="btn btn-secondary"
                      htmlFor={headingId + "-file-" + knifeIndex}
                    >
                      {labels.choose}
                    </label>
                    <input
                      ref={(el) => {
                        fileInputs.current[knifeIndex] = el;
                      }}
                      id={headingId + "-file-" + knifeIndex}
                      type="file"
                      accept={ACCEPT_ATTR}
                      multiple
                      onChange={(e) => onFilesSelected(knifeIndex, e.target.files)}
                      className="visually-hidden-input"
                    />
                  </div>
                )}
                <p
                  id={headingId + "-error-" + knifeIndex}
                  className="note error"
                  role="alert"
                  aria-live="polite"
                />
              </div>
            );
          })}

          <button
            type="button"
            className="btn btn-primary"
            onClick={onFinish}
            disabled={!allKnivesAtMinimum || busy || submitting || pending}
          >
            {submitting || pending ? labels.finishing : labels.finish}
          </button>
          {submitError ? (
            <p className="note error" role="alert">
              {submitError}
            </p>
          ) : null}
          <p id={headingId + "-error"} className="note error" role="alert" aria-live="polite" />
        </>
      )}
    </div>
  );
}
