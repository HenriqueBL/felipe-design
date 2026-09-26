import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PORTFOLIO_BUCKET, portfolioPublicUrl } from "@/lib/portfolio-url";
import type { FocalPoint } from "@/types/database";

export { PORTFOLIO_BUCKET, portfolioPublicUrl };

// ─── Public read-model types (Phase 3: Work + Media) ──────────────────────

export interface PublicPortfolioMedia {
  id: string;
  storagePath: string;
  position: number;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  altText: string | null;
}

export interface PublicPortfolioWork {
  id: string;
  title: string;
  description: string | null;
  featured: boolean;
  sortOrder: number;
  heroMediaId: string | null;
  focalPoint: FocalPoint;
  media: PublicPortfolioMedia[];
}

// ─── Mappers ──────────────────────────────────────────────────────────────

interface MediaRow {
  id: string;
  storage_path: string;
  position: number;
  width: number | null;
  height: number | null;
  aspect_ratio: number | null;
  alt_text: string | null;
}

interface ItemRow {
  id: string;
  title: string;
  description: string | null;
  published: boolean;
  featured: boolean;
  sort_order: number;
  hero_media_id: string | null;
  focal_point: FocalPoint;
}

function toPublicMedia(row: MediaRow): PublicPortfolioMedia {
  return {
    id: row.id,
    storagePath: row.storage_path,
    position: row.position,
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    altText: row.alt_text,
  };
}

function toPublicWork(
  item: ItemRow,
  mediaRows: MediaRow[],
): PublicPortfolioWork {
  const sorted = [...mediaRows].sort((a, b) => a.position - b.position);
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    featured: item.featured,
    sortOrder: item.sort_order,
    heroMediaId: item.hero_media_id,
    focalPoint: item.focal_point,
    media: sorted.map(toPublicMedia),
  };
}

// ─── Hero media resolution ────────────────────────────────────────────────

/**
 * Resolve the canonical hero media for a Work:
 * 1. child whose id === work.heroMediaId
 * 2. fallback: child at position 1
 * 3. fallback: first child by position
 * 4. null if no media exists
 */
export function resolveHeroMedia(
  work: PublicPortfolioWork,
): PublicPortfolioMedia | null {
  if (work.media.length === 0) return null;
  if (work.heroMediaId) {
    const hero = work.media.find((m) => m.id === work.heroMediaId);
    if (hero) return hero;
  }
  const pos1 = work.media.find((m) => m.position === 1);
  if (pos1) return pos1;
  return work.media[0] ?? null;
}

/**
 * Resolve cover/thumbnail media for card-level rendering.
 * Same priority as hero but used in smaller contexts.
 */
export function resolveCoverMedia(
  work: PublicPortfolioWork,
): PublicPortfolioMedia | null {
  return resolveHeroMedia(work);
}

// ─── Public queries ───────────────────────────────────────────────────────

/**
 * Featured published Work with child media for the Home Hero.
 * Returns null when no featured work exists or on failure — the Home
 * must never break due to missing portfolio data.
 */
export async function getFeaturedPortfolioWork(): Promise<PublicPortfolioWork | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: item, error } = await supabase
      .from("portfolio_items")
      .select("id, title, description, featured, sort_order, hero_media_id, focal_point")
      .eq("published", true)
      .eq("featured", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !item) return null;

    const { data: mediaRows, error: mediaError } = await supabase
      .from("portfolio_item_media")
      .select("id, storage_path, position, width, height, aspect_ratio, alt_text")
      .eq("portfolio_item_id", item.id)
      .order("position", { ascending: true });
    if (mediaError) return null;

    return toPublicWork(item as ItemRow, (mediaRows as MediaRow[]) ?? []);
  } catch {
    return null;
  }
}

/**
 * All published Works with child media, ordered by sort_order ASC
 * (fallback: created_at DESC). Returns [] on failure so the Gallery
 * shows an empty state instead of a 500.
 */
export async function listPublishedPortfolioWorks(): Promise<PublicPortfolioWork[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: items, error } = await supabase
      .from("portfolio_items")
      .select("id, title, description, featured, sort_order, hero_media_id, focal_point")
      .eq("published", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error || !items) return [];

    const ids = items.map((i) => i.id);
    const { data: allMedia } =
      ids.length > 0
        ? await supabase
            .from("portfolio_item_media")
            .select("id, portfolio_item_id, storage_path, position, width, height, aspect_ratio, alt_text")
            .in("portfolio_item_id", ids)
            .order("position", { ascending: true })
        : { data: [] };

    const mediaByItem = new Map<string, MediaRow[]>();
    for (const m of (allMedia as (MediaRow & { portfolio_item_id: string })[]) ?? []) {
      const list = mediaByItem.get(m.portfolio_item_id) ?? [];
      list.push(m);
      mediaByItem.set(m.portfolio_item_id, list);
    }

    return items.map((item) =>
      toPublicWork(item as ItemRow, mediaByItem.get(item.id) ?? []),
    );
  } catch {
    return [];
  }
}