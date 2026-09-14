"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { buildUploadPath, validateUploadFile } from "@/domain/checkout";

interface UploadLabels {
  title: string;
  description: string;
  choose: string;
  uploadedCount: string;
  done: string;
  errorExtension: string;
  errorMime: string;
  errorSize: string;
  errorTooMany: string;
  error: string;
}

interface FileItem {
  key: string;
  name: string;
  status: "uploading" | "ok" | "error";
  error?: "extension" | "mime" | "size" | "tooMany" | "upload";
}

interface UploadAreaProps {
  orderId: string;
  userId: string;
  expectedCount: number;
  currentCount: number;
  labels: UploadLabels;
}

export default function UploadArea({
  orderId,
  userId,
  expectedCount,
  currentCount,
  labels,
}: UploadAreaProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<FileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const remaining = expectedCount - currentCount;
  const canUpload = remaining > 0;

  function errorText(error: FileItem["error"]): string {
    if (error === "extension") return labels.errorExtension;
    if (error === "mime") return labels.errorMime;
    if (error === "size") return labels.errorSize;
    if (error === "tooMany") return labels.errorTooMany;
    return labels.error;
  }

  function setItemStatus(
    key: string,
    status: FileItem["status"],
    error?: FileItem["error"],
  ): void {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, status, error } : item)),
    );
  }

  async function handleFiles(selected: FileList): Promise<void> {
    if (busy || !canUpload) {
      return;
    }

    setBusy(true);
    const selectedFiles = Array.from(selected);
    setItems(
      selectedFiles.map((file, index) => ({
        key: String(index),
        name: file.name,
        status: "uploading" as const,
      })),
    );

    const supabase = createSupabaseBrowserClient();
    let acceptedCount = currentCount;
    let index = 0;

    for (const file of selectedFiles) {
      const key = String(index);
      index += 1;

      if (acceptedCount >= expectedCount) {
        setItemStatus(key, "error", "tooMany");
        continue;
      }

      const validation = validateUploadFile(file.name, file.type, file.size);
      if (!validation.ok) {
        setItemStatus(key, "error", validation.error);
        continue;
      }

      const storagePath = buildUploadPath(userId, orderId, file.name);
      const { error: storageError } = await supabase.storage
        .from("client-uploads")
        .upload(storagePath, file, { contentType: file.type });

      if (storageError) {
        setItemStatus(key, "error", "upload");
        continue;
      }

      const { error: dbError } = await supabase.from("order_images").insert({
        order_id: orderId,
        kind: "source",
        storage_path: storagePath,
        original_filename: file.name,
      });

      if (dbError) {
        await supabase.storage.from("client-uploads").remove([storagePath]);
        setItemStatus(key, "error", "upload");
        continue;
      }

      acceptedCount += 1;
      setItemStatus(key, "ok");
    }

    setBusy(false);
    router.refresh();
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files.length > 0) {
      void handleFiles(event.dataTransfer.files);
    }
  }

  return (
    <div
      className={"upload-area" + (dragOver ? " dragover" : "")}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <h3>{labels.title}</h3>
      <p>{labels.description}</p>
      <p>
        {labels.uploadedCount}: {currentCount}/{expectedCount}
      </p>
      {canUpload ? (
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {labels.choose}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                void handleFiles(event.target.files);
              }
              event.target.value = "";
            }}
          />
        </div>
      ) : (
        <p className="note">{labels.done}</p>
      )}
      {items.length > 0 && (
        <ul className="file-list">
          {items.map((item) => (
            <li
              key={item.key}
              className={item.status === "ok" ? "ok" : item.status === "error" ? "err" : ""}
            >
              <span>{item.name}</span>
              <span>
                {item.status === "ok"
                  ? "OK"
                  : item.status === "error"
                    ? errorText(item.error)
                    : "..."}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
