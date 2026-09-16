import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { requireEnv } from "@/lib/env";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// =============================================================================
// Source photo intake — Phase A (authorize) e Phase B (finalize).
//
// Arquitetura: o browser faz upload TUS/resumable direto ao Supabase Storage
// (nenhum byte atravessa Server Actions / Route Handlers / Vercel). O servidor
// e autoridade de: size, content type, count, knife, readiness.
//
// Fase A (authorizeSourcePhotoUpload): recebe apenas metadata, valida
// ownership/intake/knife/capacidade/MIME, gera UUID + path controlado e cria
// signed upload URL para o path exato. O browser recebe somente path,
// token/URL assinada e dados nao sensiveis.
//
// Fase B (finalizeSourcePhotoUpload): apos o TUS concluir, o servidor
// verifica o objeto REAL no Storage (existencia, size, content type) contra
// o snapshot do pedido, chama register_source_image (autoridade transacional,
// idempotente por storage_path — migration 0011) e, em caso de falha,
// remove o objeto recem-enviado (cleanup imediato de orfaos conhecidos).
// =============================================================================

export const SOURCE_PHOTO_BUCKET = "client-uploads";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const ALLOWED_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface AuthorizeInput {
  orderId: string;
  knifeIndex: number;
  originalFilename: string;
  requestedMime: string;
}

export interface AuthorizeOutput {
  storagePath: string;
  bucket: string;
  /** Token do signed upload para o header `x-signature` do TUS. */
  signatureToken: string;
  /** Endpoint TUS resumable assinado (fluxo oficial /resumable/sign). */
  resumableEndpoint: string;
  maxBytes: number;
  knifeIndex: number;
}

export interface FinalizeInput {
  orderId: string;
  knifeIndex: number;
  storagePath: string;
  originalFilename: string;
}

export interface FinalizeOutput {
  imageId: string;
  alreadyRegistered: boolean;
}

export class SourcePhotoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourcePhotoError";
  }
}

type Db = Database["public"];
type OrderRow = Db["Tables"]["orders"]["Row"];

function resumableEndpointForProject(): string {
  // Fluxo assinado oficial (resumable-upload-signed-uppy): endpoint /sign
  // da origem do projeto, com apikey + x-signature (sem authorization).
  const projectUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  return projectUrl.replace(/\/$/, "") + "/storage/v1/upload/resumable/sign";
}

async function loadOrderForUser(
  client: SupabaseClient<Database>,
  orderId: string,
): Promise<OrderRow> {
  const { data: order, error } = await client
    .from("orders")
    .select(
      "id, user_id, knife_quantity, source_photos_submitted_at, " +
        "required_source_photos_per_knife, max_source_photos_per_knife, " +
        "max_source_photo_size_mb",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) {
    throw new SourcePhotoError("ORDER_NOT_FOUND", "Order not found");
  }
  const row = order as unknown as OrderRow;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || row.user_id !== user.id) {
    throw new SourcePhotoError("FORBIDDEN", "Not the order owner");
  }
  return row;
}

function assertIntakeOpen(order: OrderRow): void {
  if (order.source_photos_submitted_at !== null) {
    throw new SourcePhotoError("INTAKE_CLOSED", "Photo intake already submitted");
  }
}

function assertKnifeIndex(order: OrderRow, knifeIndex: number): void {
  if (
    !Number.isInteger(knifeIndex) ||
    knifeIndex < 1 ||
    knifeIndex > order.knife_quantity
  ) {
    throw new SourcePhotoError("INVALID_KNIFE_INDEX", "Knife index out of range");
  }
}

async function countSourceForKnife(
  client: SupabaseClient<Database>,
  orderId: string,
  knifeIndex: number,
): Promise<number> {
  const { count, error } = await client
    .from("order_images")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .eq("kind", "source")
    .eq("knife_index", knifeIndex);
  if (error) {
    throw new SourcePhotoError("COUNT_FAILED", error.message);
  }
  return count ?? 0;
}

// =============================================================================
// Phase A — authorize
// =============================================================================

/** Nucleo testavel: autoriza upload com um client autenticado. */
export async function authorizeSourcePhotoUploadWithClient(
  client: SupabaseClient<Database>,
  input: AuthorizeInput,
): Promise<AuthorizeOutput> {
  const order = await loadOrderForUser(client, input.orderId);
  assertIntakeOpen(order);
  assertKnifeIndex(order, input.knifeIndex);

  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.requestedMime)) {
    throw new SourcePhotoError("UNSUPPORTED_MIME", "MIME type not allowed");
  }

  const current = await countSourceForKnife(client, input.orderId, input.knifeIndex);
  if (current >= order.max_source_photos_per_knife) {
    throw new SourcePhotoError("MAX_PHOTOS_PER_KNIFE_EXCEEDED", "Photo limit reached");
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new SourcePhotoError("NOT_AUTHENTICATED", "No session");
  }

  const ext = ALLOWED_EXTENSIONS[input.requestedMime];
  const objectName = `${randomUUID()}.${ext}`;
  const storagePath = `${user.id}/${input.orderId}/knife-${input.knifeIndex}/${objectName}`;

  const { data, error } = await client.storage
    .from(SOURCE_PHOTO_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new SourcePhotoError(
      "SIGNED_URL_FAILED",
      error?.message ?? "signed url failed",
    );
  }

  return {
    storagePath,
    bucket: SOURCE_PHOTO_BUCKET,
    signatureToken: data.token,
    resumableEndpoint: resumableEndpointForProject(),
    maxBytes: order.max_source_photo_size_mb * 1024 * 1024,
    knifeIndex: input.knifeIndex,
  };
}

export async function authorizeSourcePhotoUpload(
  input: AuthorizeInput,
): Promise<AuthorizeOutput> {
  const client = await createSupabaseServerClient();
  return authorizeSourcePhotoUploadWithClient(client, input);
}

// =============================================================================
// Phase B — finalize
// =============================================================================

interface StorageObjectStat {
  size: number;
  mimetype: string;
}

/** Consulta o objeto real no bucket (list por diretorio + search exato). */
async function statObject(
  client: SupabaseClient<Database>,
  storagePath: string,
): Promise<StorageObjectStat | null> {
  const dir = storagePath.slice(0, storagePath.lastIndexOf("/") + 1);
  const name = storagePath.slice(storagePath.lastIndexOf("/") + 1);
  const { data, error } = await client.storage
    .from(SOURCE_PHOTO_BUCKET)
    .list(dir, { search: name, limit: 1 });
  if (error || !data || data.length === 0) {
    return null;
  }
  const found = data.find((item) => item.name === name);
  if (!found || found.id === null) {
    return null;
  }
  const metadata = found.metadata as { size?: number; mimetype?: string } | null;
  if (!metadata || typeof metadata.size !== "number" || !metadata.mimetype) {
    return null;
  }
  return { size: metadata.size, mimetype: metadata.mimetype };
}

/**
 * Cleanup seguro de orfao: so remove o objeto do Storage se NENHUMA row
 * de order_images referencia este storage_path. Protege o cenario
 * "DB commit sucedeu -> resposta perdida -> retry" (o retry nao pode
 * apagar o objeto que ja esta registrado).
 */
async function removeOrphanObject(
  storagePath: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: registered } = await admin
    .from("order_images")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (registered) {
    // Objeto valido e registrado: nunca remover.
    return true;
  }
  const { error } = await admin.storage
    .from(SOURCE_PHOTO_BUCKET)
    .remove([storagePath]);
  return !error;
}

function rpcErrorCode(message: string): string {
  if (message.includes("INTAKE_CLOSED")) return "INTAKE_CLOSED";
  if (message.includes("MAX_PHOTOS_PER_KNIFE_EXCEEDED")) {
    return "MAX_PHOTOS_PER_KNIFE_EXCEEDED";
  }
  if (message.includes("INVALID_KNIFE_INDEX")) return "INVALID_KNIFE_INDEX";
  if (message.includes("FORBIDDEN")) return "FORBIDDEN";
  if (message.includes("REPLAY_MISMATCH")) return "REPLAY_MISMATCH";
  return "REGISTER_FAILED";
}

/** Nucleo testavel: finaliza upload com um client autenticado. */
export async function finalizeSourcePhotoUploadWithClient(
  client: SupabaseClient<Database>,
  input: FinalizeInput,
): Promise<FinalizeOutput> {
  const order = await loadOrderForUser(client, input.orderId);

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new SourcePhotoError("NOT_AUTHENTICATED", "No session");
  }

  // Path deve pertencer exatamente ao prefixo autorizado deste user/order/knife.
  const expectedPrefix = `${user.id}/${input.orderId}/knife-${input.knifeIndex}/`;
  if (!input.storagePath.startsWith(expectedPrefix)) {
    throw new SourcePhotoError("INVALID_PATH", "Path outside authorized prefix");
  }
  // Defense-in-depth: sem traversal e com formato controlado (uuid.ext).
  if (
    input.storagePath.includes("..") ||
    !/^[A-Za-z0-9/_-]+\.[a-z0-9]+$/u.test(input.storagePath)
  ) {
    throw new SourcePhotoError("INVALID_PATH", "Path format invalid");
  }

  // Idempotencia: se o path ja foi registrado, retorna estado consistente
  // sem depender do intake estar aberto (retry pos-timeout).
  const { data: existing } = await client
    .from("order_images")
    .select("id, kind, knife_index")
    .eq("order_id", input.orderId)
    .eq("storage_path", input.storagePath)
    .maybeSingle();
  if (existing) {
    if (existing.kind !== "source" || existing.knife_index !== input.knifeIndex) {
      throw new SourcePhotoError(
        "REPLAY_MISMATCH",
        "Path registered for another kind/knife",
      );
    }
    return { imageId: existing.id, alreadyRegistered: true };
  }

  if (order.source_photos_submitted_at !== null) {
    // Intake fechado: o objeto novo nao pode mais ser registrado —
    // remove-o para nao deixar orfao conhecido no bucket.
    const removed = await removeOrphanObject(input.storagePath);
    if (!removed) {
      console.error("[source-photos] cleanup falhou (intake fechado): ", {
        storagePath: input.storagePath,
        orderId: input.orderId,
      });
    }
    throw new SourcePhotoError("INTAKE_CLOSED", "Photo intake already submitted");
  }

  // Objeto real: existe? size/mimetype contra o snapshot do pedido.
  const stat = await statObject(client, input.storagePath);
  if (!stat) {
    throw new SourcePhotoError("OBJECT_NOT_FOUND", "Uploaded object not found");
  }
  if (stat.size > order.max_source_photo_size_mb * 1024 * 1024) {
    // Cleanup: objeto invalido nao permanece no bucket.
    await removeOrphanObject(input.storagePath);
    throw new SourcePhotoError("OBJECT_TOO_LARGE", "Object exceeds size snapshot");
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(stat.mimetype)) {
    await removeOrphanObject(input.storagePath);
    throw new SourcePhotoError("OBJECT_MIME_INVALID", "Object content type not allowed");
  }

  const { data: image, error } = await client.rpc("register_source_image", {
    p_order_id: input.orderId,
    p_knife_index: input.knifeIndex,
    p_storage_path: input.storagePath,
    p_original_filename: input.originalFilename,
  });
  if (error || !image) {
    // Registro falhou (max/estado/race): remove o objeto recem-enviado
    // para nao deixar orfao conhecido. Falha de cleanup e logada.
    const removed = await removeOrphanObject(input.storagePath);
    if (!removed) {
      console.error("[source-photos] cleanup falhou apos register_source_image: ", {
        storagePath: input.storagePath,
        orderId: input.orderId,
      });
    }
    throw new SourcePhotoError(
      rpcErrorCode(error?.message ?? ""),
      error?.message ?? "register failed",
    );
  }

  return { imageId: image.id, alreadyRegistered: false };
}

export async function finalizeSourcePhotoUpload(
  input: FinalizeInput,
): Promise<FinalizeOutput> {
  const client = await createSupabaseServerClient();
  return finalizeSourcePhotoUploadWithClient(client, input);
}

// =============================================================================
// Delete (Storage cleanup pelo cliente, apos delete_source_image)
// =============================================================================

export async function deleteSourcePhotoStorage(
  storagePath: string,
): Promise<boolean> {
  // Bucket client-uploads: DELETE e service_role-only (sem policy para
  // authenticated), entao o cleanup pos delete_source_image e server-side.
  const { error } = await createSupabaseAdminClient()
    .storage.from(SOURCE_PHOTO_BUCKET)
    .remove([storagePath]);
  if (error) {
    console.error("[source-photos] storage cleanup falhou: ", {
      storagePath,
      message: error.message,
    });
    return false;
  }
  return true;
}
