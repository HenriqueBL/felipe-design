"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateUploadFile } from "@/domain/checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";
import { PORTFOLIO_BUCKET } from "@/services/portfolio";
import type { PortfolioItemUpdate } from "@/types/database";

/**
 * Códigos estáveis retornados pelas actions. O componente admin mapeia
 * para textos localizados (EN/PT); o backend nunca retorna texto traduzido.
 */
export type PortfolioActionCode =
  | "forbidden"
  | "invalid_input"
  | "image_required"
  | "image_invalid"
  | "create_failed"
  | "update_failed"
  | "publish_failed"
  | "featured_failed"
  | "clear_featured_failed"
  | "reorder_failed"
  | "not_found"
  | "delete_failed"
  | "created"
  | "updated"
  | "published"
  | "unpublished"
  | "featured_set"
  | "featured_cleared"
  | "reordered"
  | "deleted";

export interface PortfolioActionResult {
  success: boolean;
  code: PortfolioActionCode;
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000),
  published: z.coerce.boolean(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000),
});

const idSchema = z.string().uuid();
const sortOrderSchema = z.coerce.number().int().min(0).max(100_000);

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

async function uploadPortfolioImage(file: File): Promise<string | null> {
  const validation = validateUploadFile(file.name, file.type, file.size);
  if (!validation.ok) {
    return null;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const storagePath = `items/${crypto.randomUUID()}.${extension}`;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(PORTFOLIO_BUCKET)
    .upload(storagePath, file, { contentType: file.type });
  if (error) {
    return null;
  }
  return storagePath;
}

/**
 * Verifica se um storage path ainda é referenciado por qualquer outro
 * portfolio_item (em image/before/after). Usado antes de remover objetos
 * do Storage para evitar quebrar mídia de outros itens.
 */
async function isStoragePathReferenced(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  path: string,
  excludeItemId?: string,
): Promise<boolean> {
  let query = supabase
    .from("portfolio_items")
    .select("id")
    .or(
      `image_storage_path.eq.${path},before_storage_path.eq.${path},after_storage_path.eq.${path}`,
    )
    .limit(1);
  if (excludeItemId) {
    query = query.neq("id", excludeItemId);
  }
  const { data } = await query;
  return (data?.length ?? 0) > 0;
}

/**
 * Remove um objeto do Storage somente se nenhum outro portfolio_item
 * referencia aquele path. Best-effort: falhas de remoção não quebram
 * a operação principal.
 */
async function safeRemoveStorageObject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  path: string | null,
  excludeItemId?: string,
): Promise<void> {
  if (!path) return;
  const referenced = await isStoragePathReferenced(supabase, path, excludeItemId);
  if (!referenced) {
    await supabase.storage.from(PORTFOLIO_BUCKET).remove([path]);
  }
}

export async function createPortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    sortOrder: formData.get("sortOrder") ?? 0,
    published: formData.get("published") === "on" || formData.get("published") === "true",
  });
  if (!parsed.success) {
    return { success: false, code: "invalid_input" };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, code: "image_required" };
  }
  const storagePath = await uploadPortfolioImage(file);
  if (storagePath === null) {
    return { success: false, code: "image_invalid" };
  }

  const supabase = await createSupabaseServerClient();
  // Novo modelo: item simples usa apenas image_storage_path.
  // before/after ficam NULL (migration 0021 relaxou NOT NULL).
  const { data, error } = await supabase
    .from("portfolio_items")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      image_storage_path: storagePath,
      before_storage_path: null,
      after_storage_path: null,
      published: parsed.data.published,
      sort_order: parsed.data.sortOrder,
    })
    .select("id")
    .single();

  if (error || !data) {
    await supabase.storage.from(PORTFOLIO_BUCKET).remove([storagePath]);
    return { success: false, code: "create_failed" };
  }

  revalidatePublicPages(locale);
  return { success: true, code: "created" };
}

export async function updatePortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    sortOrder: formData.get("sortOrder"),
  });
  if (!parsed.success) {
    return { success: false, code: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const updates: PortfolioItemUpdate = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    sort_order: parsed.data.sortOrder,
  };

  const file = formData.get("image");
  if (file instanceof File && file.size > 0) {
    const storagePath = await uploadPortfolioImage(file);
    if (storagePath === null) {
      return { success: false, code: "image_invalid" };
    }
    // Capturar paths antigos para limpeza segura pós-update.
    const { data: existing } = await supabase
      .from("portfolio_items")
      .select("image_storage_path, before_storage_path, after_storage_path")
      .eq("id", parsed.data.id)
      .maybeSingle();

    // Atualizar SOMENTE image_storage_path. Não sobrescrever before/after
    // para preservar itens legacy que usam o par before+after.
    updates.image_storage_path = storagePath;

    const { error } = await supabase
      .from("portfolio_items")
      .update(updates)
      .eq("id", parsed.data.id);
    if (error) {
      await supabase.storage.from(PORTFOLIO_BUCKET).remove([storagePath]);
      return { success: false, code: "update_failed" };
    }

    // Limpeza segura: remover imagem antiga apenas se não for referenciada
    // por before/after do próprio item ou por qualquer outro item.
    const oldPath = existing?.image_storage_path;
    if (oldPath && oldPath !== storagePath) {
      await safeRemoveStorageObject(supabase, oldPath, parsed.data.id);
    }
  } else {
    const { error } = await supabase
      .from("portfolio_items")
      .update(updates)
      .eq("id", parsed.data.id);
    if (error) {
      return { success: false, code: "update_failed" };
    }
  }

  revalidatePublicPages(locale);
  return { success: true, code: "updated" };
}

export async function togglePortfolioPublishAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  const published = formData.get("published") === "true";
  if (!parsedId.success) {
    return { success: false, code: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("portfolio_items")
    .update({ published })
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, code: "publish_failed" };
  }

  revalidatePublicPages(locale);
  return { success: true, code: published ? "published" : "unpublished" };
}

export async function setPortfolioFeaturedAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) {
    return { success: false, code: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_portfolio_featured", {
    target_id: parsedId.data,
  });
  if (error) {
    return { success: false, code: "featured_failed" };
  }

  revalidatePublicPages(locale);
  return { success: true, code: "featured_set" };
}

export async function clearPortfolioFeaturedAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) {
    return { success: false, code: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("portfolio_items")
    .update({ featured: false })
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, code: "clear_featured_failed" };
  }

  revalidatePublicPages(locale);
  return { success: true, code: "featured_cleared" };
}

export async function movePortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  const parsedOrder = sortOrderSchema.safeParse(formData.get("sortOrder"));
  if (!parsedId.success || !parsedOrder.success) {
    return { success: false, code: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("portfolio_items")
    .update({ sort_order: parsedOrder.data })
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, code: "reorder_failed" };
  }

  revalidatePublicPages(locale);
  return { success: true, code: "reordered" };
}

export async function deletePortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, code: "forbidden" };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) {
    return { success: false, code: "invalid_input" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("portfolio_items")
    .select("image_storage_path, before_storage_path, after_storage_path")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!existing) {
    return { success: false, code: "not_found" };
  }

  const { error } = await supabase
    .from("portfolio_items")
    .delete()
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, code: "delete_failed" };
  }

  // Limpeza segura pós-delete: remover cada path apenas se nenhum outro
  // item o referencia. O próprio item já foi deletado, então excludeItemId
  // não é necessário — a query de verificação já não o encontrará.
  const paths = [
    existing.image_storage_path,
    existing.before_storage_path,
    existing.after_storage_path,
  ];
  for (const p of paths) {
    await safeRemoveStorageObject(supabase, p);
  }

  revalidatePublicPages(locale);
  return { success: true, code: "deleted" };
}