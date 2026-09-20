"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateUploadFile } from "@/domain/checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";
import { PORTFOLIO_BUCKET } from "@/services/portfolio";
import type { PortfolioItemUpdate } from "@/types/database";

export interface PortfolioActionResult {
  success: boolean;
  message?: string;
}

// Validacoes espelham as restricoes do banco: title obrigatorio,
// description opcional, sort_order inteiro nao-negativo.
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
  // Caminho previsivel com UUID: nunca confiar no filename do usuario.
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

export async function createPortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    sortOrder: formData.get("sortOrder") ?? 0,
    published: formData.get("published") === "on" || formData.get("published") === "true",
  });
  if (!parsed.success) {
    return { success: false, message: "Invalid input." };
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: "Image is required." };
  }
  const storagePath = await uploadPortfolioImage(file);
  if (storagePath === null) {
    return { success: false, message: "Invalid image (type/extension/size)." };
  }

  const supabase = await createSupabaseServerClient();
  // before/after continuam obrigatorios no banco: item novo sem o par
  // usa a mesma imagem nos tres campos, mantendo UI e compatibilidade.
  const { data, error } = await supabase
    .from("portfolio_items")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      image_storage_path: storagePath,
      before_storage_path: storagePath,
      after_storage_path: storagePath,
      published: parsed.data.published,
      sort_order: parsed.data.sortOrder,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Nao deixar storage orfao quando o insert falha.
    await supabase.storage.from(PORTFOLIO_BUCKET).remove([storagePath]);
    return { success: false, message: "Could not create portfolio item." };
  }

  revalidatePublicPages(locale);
  return { success: true, message: "Portfolio item created." };
}

export async function updatePortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    sortOrder: formData.get("sortOrder"),
  });
  if (!parsed.success) {
    return { success: false, message: "Invalid input." };
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
      return { success: false, message: "Invalid image (type/extension/size)." };
    }
    // Capturar caminho antigo para limpeza pos-update.
    const { data: existing } = await supabase
      .from("portfolio_items")
      .select("image_storage_path, before_storage_path, after_storage_path")
      .eq("id", parsed.data.id)
      .maybeSingle();
    updates.image_storage_path = storagePath;
    updates.before_storage_path = storagePath;
    updates.after_storage_path = storagePath;
    const { error } = await supabase
      .from("portfolio_items")
      .update(updates)
      .eq("id", parsed.data.id);
    if (error) {
      await supabase.storage.from(PORTFOLIO_BUCKET).remove([storagePath]);
      return { success: false, message: "Could not update portfolio item." };
    }
    // Remover imagem antiga apenas se nao for referenciada por outro campo.
    if (existing?.image_storage_path && existing.image_storage_path !== storagePath) {
      await supabase.storage.from(PORTFOLIO_BUCKET).remove([existing.image_storage_path]);
    }
  } else {
    const { error } = await supabase
      .from("portfolio_items")
      .update(updates)
      .eq("id", parsed.data.id);
    if (error) {
      return { success: false, message: "Could not update portfolio item." };
    }
  }

  revalidatePublicPages(locale);
  return { success: true, message: "Portfolio item updated." };
}

export async function togglePortfolioPublishAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  const published = formData.get("published") === "true";
  if (!parsedId.success) {
    return { success: false, message: "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("portfolio_items")
    .update({ published })
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, message: "Could not update publication." };
  }

  revalidatePublicPages(locale);
  return { success: true, message: published ? "Item published." : "Item unpublished." };
}

export async function setPortfolioFeaturedAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) {
    return { success: false, message: "Invalid input." };
  }

  // RPC transacional: garante no maximo um featured no banco.
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_portfolio_featured", {
    target_id: parsedId.data,
  });
  if (error) {
    return { success: false, message: "Could not set featured." };
  }

  revalidatePublicPages(locale);
  return { success: true, message: "Featured updated." };
}

export async function clearPortfolioFeaturedAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) {
    return { success: false, message: "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("portfolio_items")
    .update({ featured: false })
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, message: "Could not clear featured." };
  }

  revalidatePublicPages(locale);
  return { success: true, message: "Featured removed." };
}

export async function movePortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  const parsedOrder = sortOrderSchema.safeParse(formData.get("sortOrder"));
  if (!parsedId.success || !parsedOrder.success) {
    return { success: false, message: "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("portfolio_items")
    .update({ sort_order: parsedOrder.data })
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, message: "Could not reorder." };
  }

  revalidatePublicPages(locale);
  return { success: true, message: "Order updated." };
}

export async function deletePortfolioItemAction(
  locale: string,
  _prevState: PortfolioActionResult | null,
  formData: FormData,
): Promise<PortfolioActionResult> {
  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const parsedId = idSchema.safeParse(formData.get("id"));
  if (!parsedId.success) {
    return { success: false, message: "Invalid input." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("portfolio_items")
    .select("image_storage_path, before_storage_path, after_storage_path")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!existing) {
    return { success: false, message: "Item not found." };
  }

  const { error } = await supabase
    .from("portfolio_items")
    .delete()
    .eq("id", parsedId.data);
  if (error) {
    return { success: false, message: "Could not delete." };
  }

  // Limpeza pos-delete: somente caminhos que pertenciam ao item.
  const paths = new Set(
    [existing.image_storage_path, existing.before_storage_path, existing.after_storage_path]
      .filter((p): p is string => typeof p === "string"),
  );
  if (paths.size > 0) {
    await supabase.storage.from(PORTFOLIO_BUCKET).remove([...paths]);
  }

  revalidatePublicPages(locale);
  return { success: true, message: "Item deleted." };
}