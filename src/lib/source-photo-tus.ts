"use client";

import * as tus from "tus-js-client";

// =============================================================================
// TUS resumable upload client para source photos.
//
// Requisitos da arquitetura (doc oficial Supabase resumable uploads):
//   * endpoint: https://<ref>.storage.supabase.co/storage/v1/upload/resumable
//     (hostname direto do Storage — derivado de NEXT_PUBLIC_SUPABASE_URL,
//      sem hardcode de project ref);
//   * header `x-signature` com o token do createSignedUploadUrl (signed
//     upload token autorizado server-side em Phase A);
//   * metadata: bucketName, objectName (path controlado), contentType,
//     cacheControl;
//   * chunkSize: 6 MiB (recomendacao oficial — "do not change");
//   * retryDelays oficiais [0, 3000, 5000, 10000, 20000];
//   * SEM x-upsert (paths sao unicos por UUID; conflito deve ser visivel);
//   * progress callback;
//   * abort/cancel limpo via AbortSignal;
//   * resume via findPreviousUploads/resumeFromPreviousUpload, VALIDADO:
//     so retoma se o fingerprint pertencer ao MESMO storagePath. Resume
//     nunca troca order, knife, storagePath ou autorizacao. Se a autorizacao
//     nao for mais valida, o erro e propagado de forma controlada para o
//     chamador reautorizar.
//
// Nenhum byte atravessa Server Action / Route Handler / Vercel Function.
// =============================================================================

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024; // 6 MiB (doc oficial)
export const TUS_RETRY_DELAYS = [0, 3000, 5000, 10000, 20000];

export interface SourcePhotoTusOptions {
  /** Browser File/Blob. Em ambientes Node, Buffer também é aceito. */
  file: File | Blob | Buffer;
  /** Endpoint resumable completo (hostname direto do Storage). */
  endpoint: string;
  bucket: string;
  /** Path controlado autorizado server-side: <userId>/<orderId>/knife-<i>/<uuid>.<ext> */
  storagePath: string;
  /** Token do signed upload URL (header x-signature). */
  signatureToken: string;
  /** Anon/publishable key — header global `apikey` (exemplo oficial Supabase). */
  apiKey: string;
  contentType: string;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  /** Cancelamento limpo do upload. */
  signal?: AbortSignal;
}

export class SourcePhotoTusError extends Error {
  constructor(
    public readonly code:
      | "ABORTED"
      | "UNSUPPORTED_MIME"
      | "EXPIRED_SIGNATURE"
      | "TUS_FAILED"
      | "RESUME_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "SourcePhotoTusError";
  }
}

const CLIENT_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** Deriva o endpoint resumable a partir da URL publica do projeto. */
export function resumableEndpointFromProjectUrl(projectUrl: string): string {
  const match = projectUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i);
  if (!match) {
    // Fallback seguro: mesma origem, path do Storage.
    return projectUrl.replace(/\/$/, "") + "/storage/v1/upload/resumable";
  }
  return `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable`;
}

/**
 * Endpoint resumable ASSINADO (fluxo com token x-signature).
 * Conforme exemplo oficial Supabase (resumable-upload-signed-uppy):
 *   <origin>/storage/v1/upload/resumable/sign
 */
export function signedResumableEndpointFromProjectUrl(
  projectUrl: string,
): string {
  return projectUrl.replace(/\/$/, "") + "/storage/v1/upload/resumable/sign";
}

interface TusUploadResult {
  url: string;
}

/**
 * Executa um upload TUS real contra o Supabase Storage.
 * Retorna quando o objeto estiver integralmente no bucket.
 */
export function uploadSourcePhotoViaTus(
  options: SourcePhotoTusOptions,
): Promise<TusUploadResult> {
  const {
    file,
    endpoint,
    bucket,
    storagePath,
    signatureToken,
    apiKey,
    contentType,
    onProgress,
    signal,
  } = options;

  if (!(CLIENT_ALLOWED_MIME as readonly string[]).includes(contentType)) {
    return Promise.reject(
      new SourcePhotoTusError("UNSUPPORTED_MIME", "Content type not allowed"),
    );
  }

  return new Promise<TusUploadResult>((resolve, reject) => {
    let settled = false;
    let upload: tus.Upload | null = null;

    const fail = (code: SourcePhotoTusError["code"], message: string) => {
      if (settled) return;
      settled = true;
      reject(new SourcePhotoTusError(code, message));
    };

    // Cancelamento limpo: aborta o upload TUS em andamento.
    if (signal) {
      if (signal.aborted) {
        fail("ABORTED", "Upload cancelled before start");
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          try {
            upload?.abort();
          } finally {
            fail("ABORTED", "Upload cancelled");
          }
        },
        { once: true },
      );
    }

    upload = new tus.Upload(file, {
      endpoint,
      retryDelays: TUS_RETRY_DELAYS,
      chunkSize: TUS_CHUNK_SIZE,
      // Sem x-upsert: paths unicos por UUID; conflito deve ser visivel.
      // Fluxo assinado oficial: apikey global + x-signature por upload.
      headers: {
        apikey: apiKey,
        "x-signature": signatureToken,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: storagePath,
        contentType,
        cacheControl: "3600",
      },
      onProgress: (bytesUploaded, bytesTotal) => {
        onProgress?.(bytesUploaded, bytesTotal);
      },
      onError: (error) => {
        // Token assinado expirado/invalido: falha controlada para o chamador
        // reautorizar (nova Phase A) — nunca reutiliza autorizacao invalida.
        const msg = (error?.message ?? String(error)).toLowerCase();
        if (msg.includes("expired") || msg.includes("401") || msg.includes("403")) {
          fail("EXPIRED_SIGNATURE", error?.message ?? "signature rejected");
          return;
        }
        fail("TUS_FAILED", error?.message ?? "tus upload failed");
      },
      onSuccess: () => {
        if (settled) return;
        settled = true;
        resolve({ url: upload!.url ?? "" });
      },
    });

    // Resume: apenas se um upload anterior do MESMO path existir no
    // fingerprint store. Nunca troca order/knife/storagePath — o objeto
    // anterior pertence exatamente a este path autorizado.
    upload
      .findPreviousUploads()
      .then((previousUploads) => {
        const match = previousUploads.find(
          (prev) => prev.metadata?.objectName === storagePath,
        );
        if (match) {
          upload!.resumeFromPreviousUpload(match);
        }
        upload!.start();
      })
      .catch(() => {
        // Sem storage de fingerprints disponivel: upload novo.
        upload!.start();
      });
  });
}
