import sharp from "sharp";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PORTFOLIO_BUCKET } from "@/lib/portfolio-url";
import type {
FocalPoint,
PortfolioItemMediaRow,
PortfolioItemRow,
} from "@/types/database";
import {
MAX_MEDIA_PER_WORK,
isValidFocalPoint,
computeAspectRatio,
} from "@/domain/portfolio";

// ─── Image dimension extraction (server-side, authoritative) ──────────
export async function extractImageDimensions(
buffer: Buffer,
): Promise<{ width: number; height: number } | null> {
try {
const metadata = await sharp(buffer).metadata();
if (metadata.width && metadata.height) {
return { width: metadata.width, height: metadata.height };
}
return null;
} catch {
return null;
}
}

// ─── Safe storage cleanup — only delete when unreferenced ─────────────
export async function deletePortfolioObjectIfUnreferenced(
storagePath: string,
): Promise<boolean> {
const supabase = await createSupabaseServerClient();
const { count: mediaCount } = await supabase
.from("portfolio_item_media")
.select("id", { count: "exact", head: true })
.eq("storage_path", storagePath);
if ((mediaCount ?? 0) > 0) return false;
const { count: legacyCount } = await supabase
.from("portfolio_items")
.select("id", { count: "exact", head: true })
.or(
`image_storage_path.eq.${storagePath},before_storage_path.eq.${storagePath},after_storage_path.eq.${storagePath}`,
);
if ((legacyCount ?? 0) > 0) return false;
await supabase.storage.from(PORTFOLIO_BUCKET).remove([storagePath]);
return true;
}

// ─── Published toggle via service layer ───────────────────────────────
export async function setPortfolioPublished(
workId: string,
published: boolean,
): Promise<void> {
const supabase = await createSupabaseServerClient();
const { error } = await supabase
.from("portfolio_items")
.update({ published })
.eq("id", workId);
if (error) {
throw new Error("Failed to update published status: " + error.message);
}
}

// ─── Domain types for the CMS layer ────────────────────────────────────
export interface PortfolioMedia {
id: string;
portfolioItemId: string;
storagePath: string;
position: number;
width: number | null;
height: number | null;
aspectRatio: number | null;
altText: string | null;
focalPoint: FocalPoint;
createdAt: string;
}

export interface PortfolioWork {
id: string;
title: string;
description: string | null;
published: boolean;
featured: boolean;
sortOrder: number;
heroMediaId: string | null;
focalPoint: FocalPoint;
createdAt: string;
media: PortfolioMedia[];
imageStoragePath: string | null;
beforeStoragePath: string | null;
afterStoragePath: string | null;
}

export interface PortfolioWorkSummary {
id: string;
title: string;
description: string | null;
published: boolean;
featured: boolean;
sortOrder: number;
heroMediaId: string | null;
focalPoint: FocalPoint;
mediaCount: number;
coverMedia: PortfolioMedia | null;
}

// ─── Mappers ───────────────────────────────────────────────────────────
function toMedia(row: PortfolioItemMediaRow): PortfolioMedia {
return {
id: row.id,
portfolioItemId: row.portfolio_item_id,
storagePath: row.storage_path,
position: row.position,
width: row.width,
height: row.height,
aspectRatio: row.aspect_ratio,
altText: row.alt_text,
focalPoint: row.focal_point,
createdAt: row.created_at,
};
}

function toWork(
row: PortfolioItemRow,
media: PortfolioItemMediaRow[],
): PortfolioWork {
const sorted = [...media].sort((a, b) => a.position - b.position);
return {
id: row.id,
title: row.title,
description: row.description,
published: row.published,
featured: row.featured,
sortOrder: row.sort_order,
heroMediaId: row.hero_media_id,
focalPoint: row.focal_point,
createdAt: row.created_at,
media: sorted.map(toMedia),
imageStoragePath: row.image_storage_path,
beforeStoragePath: row.before_storage_path,
afterStoragePath: row.after_storage_path,
};
}

function toSummary(work: PortfolioWork): PortfolioWorkSummary {
const cover =
work.media.find((m) => m.id === work.heroMediaId) ??
work.media.find((m) => m.position === 1) ??
work.media[0] ??
null;
return {
id: work.id,
title: work.title,
description: work.description,
published: work.published,
featured: work.featured,
sortOrder: work.sortOrder,
heroMediaId: work.heroMediaId,
focalPoint: work.focalPoint,
mediaCount: work.media.length,
coverMedia: cover,
};
}

// ─── Read operations ───────────────────────────────────────────────────
export async function listPortfolioWorks(): Promise<PortfolioWorkSummary[]> {
const supabase = await createSupabaseServerClient();
const { data: items, error } = await supabase
.from("portfolio_items")
.select("*")
.order("sort_order", { ascending: true, nullsFirst: false })
.order("created_at", { ascending: false });
if (error || !items) {
throw new Error(
"Failed to list portfolio works: " + (error?.message ?? "unknown"),
);
}
const { data: allMedia, error: mediaError } = await supabase
.from("portfolio_item_media")
.select("*")
.order("position", { ascending: true });
if (mediaError) {
throw new Error("Failed to list portfolio media: " + mediaError.message);
}
const mediaByItem = new Map<string, PortfolioItemMediaRow[]>();
for (const m of allMedia ?? []) {
const list = mediaByItem.get(m.portfolio_item_id) ?? [];
list.push(m);
mediaByItem.set(m.portfolio_item_id, list);
}
return items.map((item) =>
toSummary(toWork(item as PortfolioItemRow, mediaByItem.get(item.id) ?? [])),
);
}

export async function getPortfolioWork(id: string): Promise<PortfolioWork | null> {
const supabase = await createSupabaseServerClient();
const { data: item, error } = await supabase
.from("portfolio_items")
.select("*")
.eq("id", id)
.maybeSingle();
if (error || !item) return null;
const { data: media, error: mediaError } = await supabase
.from("portfolio_item_media")
.select("*")
.eq("portfolio_item_id", id)
.order("position", { ascending: true });
if (mediaError) {
throw new Error("Failed to load portfolio media: " + mediaError.message);
}
return toWork(item as PortfolioItemRow, (media as PortfolioItemMediaRow[]) ?? []);
}

export async function getFeaturedPortfolioWork(): Promise<PortfolioWork | null> {
const supabase = await createSupabaseServerClient();
const { data: item, error } = await supabase
.from("portfolio_items")
.select("*")
.eq("published", true)
.eq("featured", true)
.order("created_at", { ascending: false })
.limit(1)
.maybeSingle();
if (error || !item) return null;
const { data: media, error: mediaError } = await supabase
.from("portfolio_item_media")
.select("*")
.eq("portfolio_item_id", item.id)
.order("position", { ascending: true });
if (mediaError) return null;
return toWork(item as PortfolioItemRow, (media as PortfolioItemMediaRow[]) ?? []);
}

export async function listPublishedPortfolioWorks(): Promise<PortfolioWork[]> {
const supabase = await createSupabaseServerClient();
const { data: items, error } = await supabase
.from("portfolio_items")
.select("*")
.eq("published", true)
.order("sort_order", { ascending: true, nullsFirst: false })
.order("created_at", { ascending: false });
if (error || !items) return [];
const ids = items.map((i) => i.id);
const { data: allMedia } =
ids.length > 0
? await supabase
.from("portfolio_item_media")
.select("*")
.in("portfolio_item_id", ids)
.order("position", { ascending: true })
: { data: [] };
const mediaByItem = new Map<string, PortfolioItemMediaRow[]>();
for (const m of allMedia ?? []) {
const list = mediaByItem.get(m.portfolio_item_id) ?? [];
list.push(m);
mediaByItem.set(m.portfolio_item_id, list);
}
return items.map((item) =>
toWork(item as PortfolioItemRow, mediaByItem.get(item.id) ?? []),
);
}

// ─── Create ────────────────────────────────────────────────────────────
export interface CreatePortfolioWorkInput {
title: string;
description?: string | null;
published: boolean;
focalPoint?: FocalPoint;
media: Array<{
storagePath: string;
width?: number | null;
height?: number | null;
altText?: string | null;
}>;
}

export async function createPortfolioWork(
input: CreatePortfolioWorkInput,
): Promise<{ id: string }> {
if (input.media.length < 1 || input.media.length > MAX_MEDIA_PER_WORK) {
throw new Error(`Media count must be 1–${MAX_MEDIA_PER_WORK}`);
}
const fp = input.focalPoint ?? "center";
if (!isValidFocalPoint(fp)) {
throw new Error("Invalid focal point");
}
const supabase = await createSupabaseServerClient();
// Get next sort order atomically
const { data: nextOrder, error: orderError } = await supabase.rpc(
"next_portfolio_sort_order" as never,
) as unknown as { data: number | null; error: { message: string } | null };
if (orderError) {
throw new Error("Failed to get next sort order: " + orderError.message);
}
const sortOrder = typeof nextOrder === "number" ? nextOrder : 0;
// Insert parent work
const { data: work, error: workError } = await supabase
.from("portfolio_items")
.insert({
title: input.title,
description: input.description ?? null,
published: input.published,
sort_order: sortOrder,
focal_point: fp,
image_storage_path: null,
before_storage_path: null,
after_storage_path: null,
})
.select("id")
.single();
if (workError || !work) {
throw new Error(
"Failed to create work: " + (workError?.message ?? "unknown"),
);
}
// Insert media rows
const mediaRows = input.media.map((m, idx) => ({
portfolio_item_id: work.id,
storage_path: m.storagePath,
position: idx + 1,
width: m.width ?? null,
height: m.height ?? null,
aspect_ratio: computeAspectRatio(m.width, m.height),
alt_text: m.altText ?? null,
focal_point: fp,
}));
const { data: insertedMedia, error: mediaError } = await supabase
.from("portfolio_item_media")
.insert(mediaRows)
.select("id, position");
if (mediaError) {
// Rollback: delete the orphaned work
await supabase.from("portfolio_items").delete().eq("id", work.id);
throw new Error("Failed to create media: " + mediaError.message);
}
// Set hero_media_id to position 1
const heroMedia = insertedMedia?.find((m) => m.position === 1);
if (heroMedia) {
await supabase
.from("portfolio_items")
.update({ hero_media_id: heroMedia.id })
.eq("id", work.id);
}
return { id: work.id };
}

// ─── Update work metadata ─────────────────────────────────────────────
export interface UpdatePortfolioWorkInput {
title?: string;
description?: string | null;
focalPoint?: FocalPoint;
}

export async function updatePortfolioWork(
id: string,
input: UpdatePortfolioWorkInput,
): Promise<void> {
if (input.focalPoint && !isValidFocalPoint(input.focalPoint)) {
throw new Error("Invalid focal point");
}
const supabase = await createSupabaseServerClient();
const updates: Record<string, string | null> = {};
if (input.title !== undefined) updates.title = input.title;
if (input.description !== undefined) updates.description = input.description;
if (input.focalPoint !== undefined) updates.focal_point = input.focalPoint;
if (Object.keys(updates).length === 0) return;
const { error } = await supabase
.from("portfolio_items")
.update(updates as never)
.eq("id", id);
if (error) {
throw new Error("Failed to update work: " + error.message);
}
}

// ─── Media operations ──────────────────────────────────────────────────
export interface AddMediaInput {
storagePath: string;
width?: number | null;
height?: number | null;
altText?: string | null;
}

export async function addPortfolioMedia(
workId: string,
input: AddMediaInput,
): Promise<{ id: string; position: number }> {
const supabase = await createSupabaseServerClient();
// Check current count
const { count, error: countError } = await supabase
.from("portfolio_item_media")
.select("id", { count: "exact", head: true })
.eq("portfolio_item_id", workId);
if (countError) {
throw new Error("Failed to check media count: " + countError.message);
}
if ((count ?? 0) >= MAX_MEDIA_PER_WORK) {
throw new Error(`Maximum ${MAX_MEDIA_PER_WORK} media per work`);
}
// Find next available position
const { data: existing } = await supabase
.from("portfolio_item_media")
.select("position")
.eq("portfolio_item_id", workId)
.order("position", { ascending: true });
const usedPositions = new Set((existing ?? []).map((m) => m.position));
let position = 1;
while (usedPositions.has(position) && position <= MAX_MEDIA_PER_WORK) {
position++;
}
// Get work's focal point as default for new media
const { data: work } = await supabase
.from("portfolio_items")
.select("focal_point")
.eq("id", workId)
.maybeSingle();
const { data: inserted, error } = await supabase
.from("portfolio_item_media")
.insert({
portfolio_item_id: workId,
storage_path: input.storagePath,
position,
width: input.width ?? null,
height: input.height ?? null,
aspect_ratio: computeAspectRatio(input.width, input.height),
alt_text: input.altText ?? null,
focal_point: (work?.focal_point as FocalPoint) ?? "center",
})
.select("id, position")
.single();
if (error || !inserted) {
throw new Error("Failed to add media: " + (error?.message ?? "unknown"));
}
return { id: inserted.id, position: inserted.position };
}

export async function replacePortfolioMedia(
mediaId: string,
input: AddMediaInput,
): Promise<{ oldStoragePath: string | null }> {
const supabase = await createSupabaseServerClient();
const { data: existing, error: fetchError } = await supabase
.from("portfolio_item_media")
.select("storage_path, portfolio_item_id")
.eq("id", mediaId)
.maybeSingle();
if (fetchError || !existing) {
throw new Error("Media not found");
}
const { error } = await supabase
.from("portfolio_item_media")
.update({
storage_path: input.storagePath,
width: input.width ?? null,
height: input.height ?? null,
aspect_ratio: computeAspectRatio(input.width, input.height),
alt_text: input.altText ?? null,
})
.eq("id", mediaId);
if (error) {
throw new Error("Failed to replace media: " + error.message);
}
return { oldStoragePath: existing.storage_path };
}

export async function removePortfolioMedia(
mediaId: string,
): Promise<{ removedStoragePath: string; workId: string }> {
const supabase = await createSupabaseServerClient();
const { data: media, error: fetchError } = await supabase
.from("portfolio_item_media")
.select("id, portfolio_item_id, storage_path")
.eq("id", mediaId)
.maybeSingle();
if (fetchError || !media) {
throw new Error("Media not found");
}
// Check it's not the last media
const { count } = await supabase
.from("portfolio_item_media")
.select("id", { count: "exact", head: true })
.eq("portfolio_item_id", media.portfolio_item_id);
if ((count ?? 0) <= 1) {
throw new Error("Cannot remove the last media from a work");
}
// Check if this is the hero media — if so, fallback to position 1 remaining media
const { data: work } = await supabase
.from("portfolio_items")
.select("hero_media_id")
.eq("id", media.portfolio_item_id)
.maybeSingle();
if (work?.hero_media_id === mediaId) {
// Find the first remaining media by position after this one is deleted
const { data: remaining } = await supabase
.from("portfolio_item_media")
.select("id")
.eq("portfolio_item_id", media.portfolio_item_id)
.neq("id", mediaId)
.order("position", { ascending: true })
.limit(1);
const newHeroId = remaining?.[0]?.id ?? null;
await supabase
.from("portfolio_items")
.update({ hero_media_id: newHeroId })
.eq("id", media.portfolio_item_id);
}
// Delete the media
const { error: deleteError } = await supabase
.from("portfolio_item_media")
.delete()
.eq("id", mediaId);
if (deleteError) {
throw new Error("Failed to remove media: " + deleteError.message);
}
// Normalize remaining positions
const { data: remaining } = await supabase
.from("portfolio_item_media")
.select("id")
.eq("portfolio_item_id", media.portfolio_item_id)
.order("position", { ascending: true });
if (remaining && remaining.length > 0) {
const ids = remaining.map((r) => r.id);
await supabase.rpc("reorder_portfolio_media" as never, {
p_portfolio_item_id: media.portfolio_item_id,
p_media_ids: ids,
} as never);
}
return {
removedStoragePath: media.storage_path,
workId: media.portfolio_item_id,
};
}

export async function reorderPortfolioMedia(
workId: string,
mediaIds: string[],
): Promise<void> {
if (mediaIds.length === 0 || mediaIds.length > MAX_MEDIA_PER_WORK) {
throw new Error(`Media count must be 1–${MAX_MEDIA_PER_WORK}`);
}
const supabase = await createSupabaseServerClient();
const { error } = await supabase.rpc("reorder_portfolio_media" as never, {
p_portfolio_item_id: workId,
p_media_ids: mediaIds,
} as never);
if (error) {
throw new Error(
"Failed to reorder media: " +
(error instanceof Error ? error.message : String(error)),
);
}
}

// ─── Work ordering ─────────────────────────────────────────────────────
export async function reorderPortfolioWorks(workIds: string[]): Promise<void> {
if (workIds.length === 0) {
throw new Error("Work IDs must be a non-empty array");
}
const supabase = await createSupabaseServerClient();
const { error } = await supabase.rpc("reorder_portfolio_works" as never, {
work_ids: workIds,
} as never);
if (error) {
throw new Error(
"Failed to reorder works: " +
(error instanceof Error ? error.message : String(error)),
);
}
}

// ─── Featured ──────────────────────────────────────────────────────────
export async function setFeaturedPortfolioWork(workId: string): Promise<void> {
const supabase = await createSupabaseServerClient();
const { error } = await supabase.rpc("set_portfolio_featured", {
target_id: workId,
});
if (error) {
throw new Error("Failed to set featured: " + error.message);
}
}

export async function clearFeaturedPortfolioWork(workId: string): Promise<void> {
const supabase = await createSupabaseServerClient();
const { error } = await supabase
.from("portfolio_items")
.update({ featured: false })
.eq("id", workId);
if (error) {
throw new Error("Failed to clear featured: " + error.message);
}
}

// ─── Hero media & focal point ──────────────────────────────────────────
export async function setHeroMedia(
workId: string,
mediaId: string,
): Promise<void> {
const supabase = await createSupabaseServerClient();
const { data: media, error } = await supabase
.from("portfolio_item_media")
.select("id")
.eq("id", mediaId)
.eq("portfolio_item_id", workId)
.maybeSingle();
if (error || !media) {
throw new Error("Media not found or does not belong to this work");
}
const { error: updateError } = await supabase
.from("portfolio_items")
.update({ hero_media_id: mediaId })
.eq("id", workId);
if (updateError) {
throw new Error("Failed to set hero media: " + updateError.message);
}
}

export async function setFocalPoint(
workId: string,
focalPoint: FocalPoint,
): Promise<void> {
if (!isValidFocalPoint(focalPoint)) {
throw new Error("Invalid focal point");
}
const supabase = await createSupabaseServerClient();
const { error } = await supabase
.from("portfolio_items")
.update({ focal_point: focalPoint })
.eq("id", workId);
if (error) {
throw new Error("Failed to set focal point: " + error.message);
}
}

// ─── Delete work ───────────────────────────────────────────────────────
export async function deletePortfolioWork(
workId: string,
): Promise<{ storagePaths: string[] }> {
const supabase = await createSupabaseServerClient();
// Collect all media paths before deletion
const { data: media } = await supabase
.from("portfolio_item_media")
.select("storage_path")
.eq("portfolio_item_id", workId);
const storagePaths = (media ?? []).map((m) => m.storage_path);
// Also collect legacy paths from the parent
const { data: work } = await supabase
.from("portfolio_items")
.select("image_storage_path, before_storage_path, after_storage_path")
.eq("id", workId)
.maybeSingle();
if (work) {
if (work.image_storage_path) storagePaths.push(work.image_storage_path);
if (work.before_storage_path) storagePaths.push(work.before_storage_path);
if (work.after_storage_path) storagePaths.push(work.after_storage_path);
}
// Delete the work (cascade deletes media via FK)
const { error } = await supabase
.from("portfolio_items")
.delete()
.eq("id", workId);
if (error) {
throw new Error("Failed to delete work: " + error.message);
}
return { storagePaths: [...new Set(storagePaths)] };
}