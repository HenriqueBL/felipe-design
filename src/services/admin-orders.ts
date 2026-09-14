import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderImageRow, OrderRevisionRow, OrderRow } from "@/types/database";

export interface OrderImageWithUrl extends OrderImageRow {
  signedUrl: string | null;
}

export interface AdminOrderDetail {
  order: OrderRow;
  customerEmail: string | null;
  planAngles: number | null;
  sourceImages: OrderImageWithUrl[];
  resultImages: OrderImageWithUrl[];
  revisions: OrderRevisionRow[];
}

// Gera signed URLs temporarias (1h) para as fotos; buckets seguem privados.
async function attachSignedUrls(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  images: OrderImageRow[],
): Promise<OrderImageWithUrl[]> {
  return Promise.all(
    images.map(async (image) => {
      const bucket = image.kind === "source" ? "client-uploads" : "order-results";
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(image.storage_path, 3600);
      return {
        ...image,
        signedUrl: error || !data ? null : data.signedUrl,
      };
    }),
  );
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

  const [planResult, profileResult, imagesResult, revisionsResult] = await Promise.all([
    supabase.from("plans").select("angles").eq("id", order.plan_id).maybeSingle(),
    supabase.from("profiles").select("email").eq("id", order.user_id).maybeSingle(),
    supabase.from("order_images").select("*").eq("order_id", orderId).order("created_at"),
    supabase.from("order_revisions").select("*").eq("order_id", orderId).order("round"),
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
    customerEmail: profileResult.data?.email ?? null,
    planAngles: planResult.data?.angles ?? null,
    sourceImages: withUrls.filter((image) => image.kind === "source"),
    resultImages: withUrls.filter((image) => image.kind === "result"),
    revisions: revisionsResult.data ?? [],
  };
}
