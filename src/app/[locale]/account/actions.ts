"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MockPaymentFlowError, simulateMockPayment } from "@/services/mock-payment-flow";
import {
  SourcePhotoError,
  authorizeSourcePhotoUpload,
  deleteSourcePhotoStorage,
  finalizeSourcePhotoUpload,
} from "@/services/source-photos";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SimulatePaymentResult {
  success: boolean;
  errorCode?: string;
}

export interface RevisionResult {
  success: boolean;
  errorCode?: string;
}

const orderIdSchema = z.string().uuid();
const revisionSchema = z.object({
  orderId: z.string().uuid(),
  notes: z.string().trim().min(1).max(2000),
});

function safeLocale(locale: string): "en" | "pt" {
  return locale === "pt" ? "pt" : "en";
}

// Pagamento simulado (apenas desenvolvimento): acao recebe somente o orderId.
// Valor, moeda, prazo e transicoes de estado sao resolvidos no servidor.
export async function simulateMockPaymentAction(
  locale: string,
  _prevState: SimulatePaymentResult | null,
  formData: FormData,
): Promise<SimulatePaymentResult> {
  const parsed = orderIdSchema.safeParse(formData.get("orderId"));
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }

  try {
    await simulateMockPayment(parsed.data);
  } catch (error) {
    const code = error instanceof MockPaymentFlowError ? error.code : "UNKNOWN";
    return { success: false, errorCode: code };
  }

  const current = safeLocale(locale);
  revalidatePath("/" + current + "/account/orders/" + parsed.data);
  revalidatePath("/" + current + "/account");
  return { success: true };
}

// Revisao gratuita: chama a RPC request_order_revision que valida dono,
// status concluido, existencia de entrega e limite de 1 revisao.
export async function requestRevisionAction(
  locale: string,
  _prevState: RevisionResult | null,
  formData: FormData,
): Promise<RevisionResult> {
  const parsed = revisionSchema.safeParse({
    orderId: formData.get("orderId"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_order_revision", {
    p_order_id: parsed.data.orderId,
    p_notes: parsed.data.notes,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("FORBIDDEN")) {
      return { success: false, errorCode: "FORBIDDEN" };
    }
    if (message.includes("ORDER_NOT_COMPLETED")) {
      return { success: false, errorCode: "ORDER_NOT_COMPLETED" };
    }
    if (message.includes("REVISION_ALREADY_REQUESTED")) {
      return { success: false, errorCode: "REVISION_ALREADY_REQUESTED" };
    }
    return { success: false, errorCode: "UNKNOWN" };
  }

  const current = safeLocale(locale);
  revalidatePath("/" + current + "/account/orders/" + parsed.data.orderId);
  revalidatePath("/" + current + "/account");
  return { success: true };
}

// =============================================================================
// Source photo intake — wrappers de Server Action (somente metadata).
// Nenhum File/Blob atravessa Server Actions: o upload TUS vai direto do
// browser ao Supabase Storage. Aqui apenas authorize/finalize/delete/submit.
// =============================================================================

export interface AuthorizeSourcePhotoResult {
  success: boolean;
  errorCode?: string;
  /** Dados necessarios ao TUS (path, token, endpoint, limites). */
  data?: {
    storagePath: string;
    bucket: string;
    signatureToken: string;
    resumableEndpoint: string;
    maxBytes: number;
    knifeIndex: number;
  };
}

export interface FinalizeSourcePhotoResult {
  success: boolean;
  errorCode?: string;
  imageId?: string;
  alreadyRegistered?: boolean;
}

export interface DeleteSourcePhotoResult {
  success: boolean;
  errorCode?: string;
}

export interface SubmitSourcePhotosResult {
  success: boolean;
  errorCode?: string;
}

const knifeIndexSchema = z.coerce.number().int().min(1).max(100);
const originalFilenameSchema = z.string().trim().min(1).max(255);
const requestedMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

const authorizeSchema = z.object({
  orderId: z.string().uuid(),
  knifeIndex: knifeIndexSchema,
  originalFilename: originalFilenameSchema,
  requestedMime: requestedMimeSchema,
});

const finalizeSchema = z.object({
  orderId: z.string().uuid(),
  knifeIndex: knifeIndexSchema,
  storagePath: z
    .string()
    .regex(/^[A-Za-z0-9/_-]+\.[a-z0-9]+$/u, "Invalid storage path"),
  originalFilename: originalFilenameSchema,
});

const deleteSchema = z.object({
  orderId: z.string().uuid(),
  imageId: z.string().uuid(),
});

function photoErrorCode(error: unknown): string {
  if (error instanceof SourcePhotoError) {
    return error.code;
  }
  return "UNKNOWN";
}

// Phase A: autoriza o upload (metadata) e devolve o contrato do TUS.
export async function authorizeSourcePhotoUploadAction(
  input: z.infer<typeof authorizeSchema>,
): Promise<AuthorizeSourcePhotoResult> {
  const parsed = authorizeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }
  try {
    const auth = await authorizeSourcePhotoUpload(parsed.data);
    return {
      success: true,
      data: {
        storagePath: auth.storagePath,
        bucket: auth.bucket,
        signatureToken: auth.signatureToken,
        resumableEndpoint: auth.resumableEndpoint,
        maxBytes: auth.maxBytes,
        knifeIndex: auth.knifeIndex,
      },
    };
  } catch (error) {
    return { success: false, errorCode: photoErrorCode(error) };
  }
}

// Phase B: valida o objeto real no Storage e registra via RPC.
export async function finalizeSourcePhotoUploadAction(
  input: z.infer<typeof finalizeSchema>,
): Promise<FinalizeSourcePhotoResult> {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }
  try {
    const result = await finalizeSourcePhotoUpload(parsed.data);
    revalidatePath("/en/account/orders/" + parsed.data.orderId);
    revalidatePath("/pt/account/orders/" + parsed.data.orderId);
    return {
      success: true,
      imageId: result.imageId,
      alreadyRegistered: result.alreadyRegistered,
    };
  } catch (error) {
    return { success: false, errorCode: photoErrorCode(error) };
  }
}

// Delete (antes do submit): RPC delete_source_image + cleanup do Storage.
export async function deleteSourcePhotoAction(
  input: z.infer<typeof deleteSchema>,
): Promise<DeleteSourcePhotoResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("delete_source_image", {
    p_image_id: parsed.data.imageId,
  });
  if (error || !data) {
    const message = error?.message ?? "";
    if (message.includes("FORBIDDEN")) {
      return { success: false, errorCode: "FORBIDDEN" };
    }
    if (message.includes("INTAKE_CLOSED")) {
      return { success: false, errorCode: "INTAKE_CLOSED" };
    }
    if (message.includes("NOT_FOUND")) {
      return { success: false, errorCode: "NOT_FOUND" };
    }
    return { success: false, errorCode: "UNKNOWN" };
  }
  // Cleanup do objeto no Storage (server-side admin client), best-effort.
  await deleteSourcePhotoStorage(data);
  revalidatePath("/en/account/orders/" + parsed.data.orderId);
  revalidatePath("/pt/account/orders/" + parsed.data.orderId);
  revalidatePath("/en/account");
  revalidatePath("/pt/account");
  return { success: true };
}

// Fecha o intake: valida minimo por faca no servidor (RPC submit_source_photos).
export async function submitSourcePhotosAction(
  orderId: string,
): Promise<SubmitSourcePhotosResult> {
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_source_photos", {
    p_order_id: parsed.data,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("FORBIDDEN")) {
      return { success: false, errorCode: "FORBIDDEN" };
    }
    if (message.includes("INTAKE_CLOSED")) {
      return { success: false, errorCode: "INTAKE_CLOSED" };
    }
    if (message.includes("MIN_NOT_MET")) {
      return { success: false, errorCode: "MIN_NOT_MET" };
    }
    return { success: false, errorCode: "UNKNOWN" };
  }
  revalidatePath("/en/account/orders/" + parsed.data);
  revalidatePath("/pt/account/orders/" + parsed.data);
  revalidatePath("/en/account");
  revalidatePath("/pt/account");
  revalidatePath("/en/dashboard");
  revalidatePath("/pt/dashboard");
  return { success: true };
}
