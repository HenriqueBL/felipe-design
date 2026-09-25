"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateUploadFile } from "@/domain/checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";
import { PORTFOLIO_BUCKET } from "@/services/portfolio";
import {
  extractImageDimensions,
  deletePortfolioObjectIfUnreferenced,
  setPortfolioPublished,
} from "@/services/portfolio-cms";
import {
  createPortfolioWork,
  updatePortfolioWork,
  addPortfolioMedia,
  replacePortfolioMedia,
  removePortfolioMedia,
  reorderPortfolioMedia,
  reorderPortfolioWorks,
  setFeaturedPortfolioWork,
  clearFeaturedPortfolioWork,
  setHeroMedia,
  setFocalPoint,
  deletePortfolioWork,
  listPortfolioWorks,
} from "@/services/portfolio-cms";
import type { FocalPoint } from "@/types/database";
import { isValidFocalPoint, MAX_MEDIA_PER_WORK } from "@/domain/portfolio";

export type CmsActionCode =
  | "forbidden"
  | "invalid_input"
  | "create_failed"
  | "update_failed"
  | "media_add_failed"
  | "media_replace_failed"
  | "media_remove_failed"
  | "media_reorder_failed"
  | "work_reorder_failed"
  | "featured_failed"
  | "clear_featured_failed"
  | "hero_failed"
  | "focal_point_failed"
  | "delete_failed"
  | "created"
  | "updated"
  | "media_added"
  | "media_replaced"
  | "media_removed"
  | "media_reordered"
  | "work_reordered"
  | "featured_set"
  | "featured_cleared"
  | "hero_set"
  | "focal_point_set"
  | "deleted";

export interface CmsActionResult {
  success: boolean;
  code: CmsActionCode;
  data?: Record<string, unknown>;
}

function safeLocale(locale: string): string {
  return locale === "pt" ? "pt" : "en";
}

function revalidatePublicPages(locale: string): void {
  for (const l of ["en", "pt"]) {
    revalidatePath("/" + l);
    revalidatePath("/" + l + "/gallery");
  }
  revalidatePath("/" + safeLocale(locale) + "/dashboard/portfolio");
}

async function uploadPortfolioImage(
  file: File,
): Promise<{ storagePath: string; width: number | null; height: number | null } | null> {
  const validation = validateUploadFile(file.name, file.type, file.size);
  if (!validation.ok) {
    return null;
  }
  // Extract dimensions server-side before upload — mandatory for valid images
  const buffer = Buffer.from(await file.arrayBuffer());
  const dims = await extractImageDimensions(buffer);
  if (!dims || dims.width <= 0 || dims.height <= 0) {
    // Valid image types (JPEG/PNG/WebP) must produce dimensions via sharp.
    // Reject upload rather than persisting null dimensions.
    return null;
  }
  const width = dims.width;
  const height = dims.height;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const storagePath = `items/${crypto.randomUUID()}.${extension}`;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(PORTFOLIO_BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (error) {
    return null;
  }
  return { storagePath, width, height };
}

// ─── Create Work ──────────────────────────────────────────────────────

const createWorkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  published: z.coerce.boolean(),
});

export async function createWorkAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsed = createWorkSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    published: formData.get("published") === "on" || formData.get("published") === "true",
  });
  if (!parsed.success) {
    return { success: false, code: "invalid_input" };
  }

  // Collect media files (up to MAX_MEDIA_PER_WORK)
  const mediaFiles: File[] = [];
  for (let i = 0; i < MAX_MEDIA_PER_WORK; i++) {
    const file = formData.get(`media_${i}`);
    if (file instanceof File && file.size > 0) {
      mediaFiles.push(file);
    }
  }

  if (mediaFiles.length === 0) {
    return { success: false, code: "invalid_input" };
  }

  // Upload all media files first
  const uploadedMedia: Array<{ storagePath: string; width: number | null; height: number | null }> = [];
  for (const file of mediaFiles) {
    const result = await uploadPortfolioImage(file);
    if (result === null) {
      // Clean up already uploaded files
      const supabase = await createSupabaseServerClient();
      for (const m of uploadedMedia) {
        await supabase.storage.from(PORTFOLIO_BUCKET).remove([m.storagePath]);
      }
      return { success: false, code: "media_add_failed" };
    }
    uploadedMedia.push(result);
  }

  try {
    const result = await createPortfolioWork({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      published: parsed.data.published,
      media: uploadedMedia.map((m) => ({
        storagePath: m.storagePath,
        width: m.width,
        height: m.height,
      })),
    });

    revalidatePublicPages(locale);
    return { success: true, code: "created", data: { id: result.id } };
  } catch {
    // Clean up uploaded files on failure
    const supabase = await createSupabaseServerClient();
    for (const m of uploadedMedia) {
      await supabase.storage.from(PORTFOLIO_BUCKET).remove([m.storagePath]);
    }
    return { success: false, code: "create_failed" };
  }
}

// ─── Update Work Metadata ─────────────────────────────────────────────

const updateWorkSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export async function updateWorkAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsed = updateWorkSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await updatePortfolioWork(parsed.data.id, {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
    });

    revalidatePublicPages(locale);
    return { success: true, code: "updated" };
  } catch {
    return { success: false, code: "update_failed" };
  }
}

// ─── Add Media ────────────────────────────────────────────────────────

export async function addMediaAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  if (typeof workId !== "string" || !z.string().uuid().safeParse(workId).success) {
    return { success: false, code: "invalid_input" };
  }

  const file = formData.get("media");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, code: "invalid_input" };
  }

  const upload = await uploadPortfolioImage(file);
  if (upload === null) {
    return { success: false, code: "media_add_failed" };
  }

  try {
    const result = await addPortfolioMedia(workId, {
      storagePath: upload.storagePath,
      width: upload.width,
      height: upload.height,
    });
    revalidatePublicPages(locale);
    return { success: true, code: "media_added", data: { id: result.id, position: result.position } };
  } catch {
    // Clean up uploaded file
    const supabase = await createSupabaseServerClient();
    await supabase.storage.from(PORTFOLIO_BUCKET).remove([upload.storagePath]);
    return { success: false, code: "media_add_failed" };
  }
}

// ─── Replace Media ────────────────────────────────────────────────────

export async function replaceMediaAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const mediaId = formData.get("mediaId");
  if (typeof mediaId !== "string" || !z.string().uuid().safeParse(mediaId).success) {
    return { success: false, code: "invalid_input" };
  }

  const file = formData.get("media");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, code: "invalid_input" };
  }

  const upload = await uploadPortfolioImage(file);
  if (upload === null) {
    return { success: false, code: "media_replace_failed" };
  }

  try {
    const result = await replacePortfolioMedia(mediaId, {
      storagePath: upload.storagePath,
      width: upload.width,
      height: upload.height,
    });
    // Safe storage cleanup for old path — only delete if unreferenced
    if (result.oldStoragePath) {
      await deletePortfolioObjectIfUnreferenced(result.oldStoragePath);
    }
    revalidatePublicPages(locale);
    return { success: true, code: "media_replaced" };
  } catch {
    // Clean up new uploaded file
    await deletePortfolioObjectIfUnreferenced(upload.storagePath);
    return { success: false, code: "media_replace_failed" };
  }
}

// ─── Remove Media ─────────────────────────────────────────────────────

export async function removeMediaAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const mediaId = formData.get("mediaId");
  if (typeof mediaId !== "string" || !z.string().uuid().safeParse(mediaId).success) {
    return { success: false, code: "invalid_input" };
  }

  // Get admin user ID for atomic RPC authorization
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, code: "forbidden" };
  }

  try {
    const result = await removePortfolioMedia(mediaId, user.id);
    revalidatePublicPages(locale);
    // Best-effort storage cleanup after DB success — failure does not affect response
    try {
      await deletePortfolioObjectIfUnreferenced(result.removedStoragePath);
    } catch (cleanupError) {
      console.error("[portfolio] Storage cleanup failed after successful DB remove:", cleanupError);
    }
    return { success: true, code: "media_removed" };
  } catch {
    return { success: false, code: "media_remove_failed" };
  }
}

// ─── Reorder Media ────────────────────────────────────────────────────

export async function reorderMediaAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  const mediaIdsRaw = formData.get("mediaIds");
  if (typeof workId !== "string" || typeof mediaIdsRaw !== "string") {
    return { success: false, code: "invalid_input" };
  }

  let mediaIds: string[];
  try {
    mediaIds = JSON.parse(mediaIdsRaw);
  } catch {
    return { success: false, code: "invalid_input" };
  }

  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await reorderPortfolioMedia(workId, mediaIds);
    revalidatePublicPages(locale);
    return { success: true, code: "media_reordered" };
  } catch {
    return { success: false, code: "media_reorder_failed" };
  }
}

// ─── Reorder Works ────────────────────────────────────────────────────

export async function reorderWorksAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workIdsRaw = formData.get("workIds");
  if (typeof workIdsRaw !== "string") {
    return { success: false, code: "invalid_input" };
  }

  let workIds: string[];
  try {
    workIds = JSON.parse(workIdsRaw);
  } catch {
    return { success: false, code: "invalid_input" };
  }

  if (!Array.isArray(workIds) || workIds.length === 0) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await reorderPortfolioWorks(workIds);
    revalidatePublicPages(locale);
    return { success: true, code: "work_reordered" };
  } catch {
    return { success: false, code: "work_reorder_failed" };
  }
}

// ─── Set Featured ─────────────────────────────────────────────────────

export async function setFeaturedAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  if (typeof workId !== "string" || !z.string().uuid().safeParse(workId).success) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await setFeaturedPortfolioWork(workId);
    revalidatePublicPages(locale);
    return { success: true, code: "featured_set" };
  } catch {
    return { success: false, code: "featured_failed" };
  }
}

// ─── Clear Featured ───────────────────────────────────────────────────

export async function clearFeaturedAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  if (typeof workId !== "string" || !z.string().uuid().safeParse(workId).success) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await clearFeaturedPortfolioWork(workId);
    revalidatePublicPages(locale);
    return { success: true, code: "featured_cleared" };
  } catch {
    return { success: false, code: "clear_featured_failed" };
  }
}

// ─── Set Hero Media ───────────────────────────────────────────────────

export async function setHeroMediaAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  const mediaId = formData.get("mediaId");
  if (
    typeof workId !== "string" ||
    typeof mediaId !== "string" ||
    !z.string().uuid().safeParse(workId).success ||
    !z.string().uuid().safeParse(mediaId).success
  ) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await setHeroMedia(workId, mediaId);
    revalidatePublicPages(locale);
    return { success: true, code: "hero_set" };
  } catch {
    return { success: false, code: "hero_failed" };
  }
}

// ─── Set Focal Point ──────────────────────────────────────────────────

export async function setFocalPointAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  const focalPoint = formData.get("focalPoint");
  if (
    typeof workId !== "string" ||
    !z.string().uuid().safeParse(workId).success ||
    typeof focalPoint !== "string" ||
    !isValidFocalPoint(focalPoint)
  ) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await setFocalPoint(workId, focalPoint as FocalPoint);
    revalidatePublicPages(locale);
    return { success: true, code: "focal_point_set" };
  } catch {
    return { success: false, code: "focal_point_failed" };
  }
}

// ─── Delete Work ──────────────────────────────────────────────────────

export async function deleteWorkAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  if (typeof workId !== "string" || !z.string().uuid().safeParse(workId).success) {
    return { success: false, code: "invalid_input" };
  }

  try {
    const result = await deletePortfolioWork(workId);
    // Safe storage cleanup — only delete unreferenced objects
    for (const path of result.storagePaths) {
      await deletePortfolioObjectIfUnreferenced(path);
    }
    revalidatePublicPages(locale);
    return { success: true, code: "deleted" };
  } catch {
    return { success: false, code: "delete_failed" };
  }
}

// ─── Toggle Published ─────────────────────────────────────────────────

export async function togglePublishedAction(
  locale: string,
  _prevState: CmsActionResult | null,
  formData: FormData,
): Promise<CmsActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const workId = formData.get("workId");
  const published = formData.get("published") === "true";
  if (typeof workId !== "string" || !z.string().uuid().safeParse(workId).success) {
    return { success: false, code: "invalid_input" };
  }

  try {
    await setPortfolioPublished(workId, published);
    revalidatePublicPages(locale);
    return { success: true, code: "updated" };
  } catch {
    return { success: false, code: "update_failed" };
  }
}

// ─── List Works (for server component) ────────────────────────────────

export { listPortfolioWorks };