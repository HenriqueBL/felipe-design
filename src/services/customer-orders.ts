import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrderImageRow, OrderRow, OrderRevisionRow, PaymentRow } from "@/types/database";

export interface CustomerOrderDetail {
  order: OrderRow;
  planAngles: number | null;
  sourceImages: OrderImageRow[];
  resultImages: OrderImageRow[];
  revisions: OrderRevisionRow[];
  payments: PaymentRow[];
}

export async function listCustomerOrders(userId: string): Promise<OrderRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to list orders: " + error.message);
  }
  return data ?? [];
}

export async function getCustomerOrder(orderId: string): Promise<OrderRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load order: " + error.message);
  }
  return data ?? null;
}

export async function getCustomerOrderDetail(orderId: string): Promise<CustomerOrderDetail | null> {
  const order = await getCustomerOrder(orderId);
  if (!order) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const [planResult, imagesResult, revisionsResult, paymentsResult] = await Promise.all([
    supabase.from("plans").select("angles").eq("id", order.plan_id).maybeSingle(),
    supabase.from("order_images").select("*").eq("order_id", orderId).order("created_at"),
    supabase.from("order_revisions").select("*").eq("order_id", orderId).order("round"),
    supabase.from("payments").select("*").eq("order_id", orderId).order("created_at"),
  ]);

  if (imagesResult.error) {
    throw new Error("Failed to load order images: " + imagesResult.error.message);
  }
  if (revisionsResult.error) {
    throw new Error("Failed to load order revisions: " + revisionsResult.error.message);
  }
  if (paymentsResult.error) {
    throw new Error("Failed to load order payments: " + paymentsResult.error.message);
  }

  const images = imagesResult.data ?? [];
  return {
    order,
    planAngles: planResult.data?.angles ?? null,
    sourceImages: images.filter((image) => image.kind === "source"),
    resultImages: images.filter((image) => image.kind === "result"),
    revisions: revisionsResult.data ?? [],
    payments: paymentsResult.data ?? [],
  };
}

export async function createSignedDownloadUrl(
  bucket: string,
  storagePath: string,
  expiresIn = 3600,
): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, expiresIn);
  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}
