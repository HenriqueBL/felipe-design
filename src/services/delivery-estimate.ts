import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EstimateDeliveryResult } from "@/types/database";

export async function fetchDeliveryEstimate(newImages: number): Promise<EstimateDeliveryResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("estimate_delivery", {
    p_new_images: newImages,
  });

  if (error) {
    throw new Error("Failed to estimate delivery: " + error.message);
  }
  return data;
}
