import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PORTFOLIO_BUCKET, portfolioPublicUrl } from "@/lib/portfolio-url";
import type { PortfolioItemRow } from "@/types/database";

export { PORTFOLIO_BUCKET, portfolioPublicUrl };

export interface PublicPortfolioItem {
  id: string;
  title: string;
  description: string | null;
  imageStoragePath: string | null;
  beforeStoragePath: string | null;
  afterStoragePath: string | null;
  /** Caminho de mídia resolvido para renderização (hero, gallery, thumb). */
  resolvedMediaPath: string | null;
  featured: boolean;
  sortOrder: number;
}

/**
 * Resolve a imagem principal de um item do portfolio com fallback seguro:
 * 1. image_storage_path (modelo novo)
 * 2. after_storage_path (legacy: resultado final)
 * 3. before_storage_path (legacy: último recurso)
 * Retorna null quando o item não possui nenhuma mídia válida.
 */
export function resolvePortfolioMedia(item: {
  imageStoragePath: string | null;
  beforeStoragePath: string | null;
  afterStoragePath: string | null;
}): string | null {
  return (
    item.imageStoragePath ??
    item.afterStoragePath ??
    item.beforeStoragePath ??
    null
  );
}

function toPublicItem(row: PortfolioItemRow): PublicPortfolioItem {
  const item = {
    id: row.id,
    title: row.title,
    description: row.description,
    imageStoragePath: row.image_storage_path,
    beforeStoragePath: row.before_storage_path,
    afterStoragePath: row.after_storage_path,
    featured: row.featured,
    sortOrder: row.sort_order,
  };
  return {
    ...item,
    resolvedMediaPath: resolvePortfolioMedia(item),
  };
}

/**
 * Item destaque publicado para o hero da Home.
 * Retorna null quando nao ha destaque, destaque despublicado ou
 * banco indisponivel — a Home nunca deve quebrar por falta da foto.
 */
export async function getFeaturedPortfolioItem(): Promise<PublicPortfolioItem | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("portfolio_items")
      .select("*")
      .eq("published", true)
      .eq("featured", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) {
      return null;
    }
    return toPublicItem(data);
  } catch {
    return null;
  }
}

/**
 * Itens publicados, ordenados por sort_order (fallback: created_at desc).
 * Em caso de indisponibilidade do banco, retorna lista vazia — a Gallery
 * mostra o estado vazio em vez de erro 500.
 */
export async function listPublishedPortfolioItems(): Promise<PublicPortfolioItem[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("portfolio_items")
      .select("*")
      .eq("published", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) {
      return [];
    }
    return (data ?? []).map(toPublicItem);
  } catch {
    return [];
  }
}

/** Todos os itens (admin): inclui drafts, ordenacao de edicao. */
export async function listAllPortfolioItems(): Promise<PortfolioItemRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("portfolio_items")
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error("Failed to list portfolio items: " + error.message);
  }
  return data ?? [];
}