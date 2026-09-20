import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  OrderImageRow,
  OrderItemRow,
  OrderRevisionRow,
  OrderRow,
} from "@/types/database";

export interface OrderImageWithUrl extends OrderImageRow {
  signedUrl: string | null;
}

export interface AdminOrderDetail {
  order: OrderRow;
  items: OrderItemRow[];
  customerEmail: string | null;
  planAngles: number | null;
  sourceImages: OrderImageWithUrl[];
  resultImages: OrderImageWithUrl[];
  revisions: OrderRevisionRow[];
}

// Gera signed URLs temporarias (1h) para as fotos; buckets seguem privados.
// Uma chamada createSignedUrls por bucket em vez de N chamadas individuais.
// Mapeamento por storage_path: falha parcial nunca associa URL errada.
async function attachSignedUrls(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  images: OrderImageRow[],
): Promise<OrderImageWithUrl[]> {
  if (images.length === 0) {
    return [];
  }

  const byBucket = new Map<string, string[]>();
  for (const image of images) {
    const bucket = image.kind === "source" ? "client-uploads" : "order-results";
    const paths = byBucket.get(bucket) ?? [];
    paths.push(image.storage_path);
    byBucket.set(bucket, paths);
  }

  const urlsByPath = new Map<string, string>();
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(paths, 3600);
      if (error || !data) {
        return;
      }
      for (const entry of data) {
        if (entry.path && !entry.error && entry.signedUrl) {
          urlsByPath.set(entry.path, entry.signedUrl);
        }
      }
    }),
  );

  return images.map((image) => ({
    ...image,
    signedUrl: urlsByPath.get(image.storage_path) ?? null,
  }));
}

// RLS permite ao admin enxergar qualquer pedido; clientes so os proprios.
export async function getAdminOrderDetail(orderId: string): Promise<AdminOrderDetail | null> {
  const supabase = await createSupabaseServerClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    return null;
  }

  const [planResult, profileResult, imagesResult, revisionsResult, itemsResult] =
    await Promise.all([
      order.plan_id
        ? supabase.from("plans").select("angles").eq("id", order.plan_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from("profiles").select("email").eq("id", order.user_id).maybeSingle(),
      supabase.from("order_images").select("*").eq("order_id", orderId).order("created_at"),
      supabase.from("order_revisions").select("*").eq("order_id", orderId).order("round"),
      supabase
        .from("order_items")
        .select("*")
        .eq("order_id", orderId)
        .order("item_index"),
    ]);

  if (imagesResult.error) {
    throw new Error("Failed to load order images: " + imagesResult.error.message);
  }
  if (revisionsResult.error) {
    throw new Error("Failed to load revisions: " + revisionsResult.error.message);
  }

  const withUrls = await attachSignedUrls(supabase, imagesResult.data ?? []);

  return {
    order,
    items: itemsResult.data ?? [],
    customerEmail: profileResult.data?.email ?? null,
    planAngles: planResult.data?.angles ?? null,
    sourceImages: withUrls.filter((image) => image.kind === "source"),
    resultImages: withUrls.filter((image) => image.kind === "result"),
    revisions: revisionsResult.data ?? [],
  };
}
