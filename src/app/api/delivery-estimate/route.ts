import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchDeliveryEstimate } from "@/services/delivery-estimate";

const querySchema = z.object({
  images: z.coerce.number().int().min(1).max(300),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ images: searchParams.get("images") ?? undefined });

  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_IMAGES" }, { status: 400 });
  }

  try {
    const estimate = await fetchDeliveryEstimate(parsed.data.images);
    return NextResponse.json(estimate);
  } catch {
    return NextResponse.json({ error: "ESTIMATE_UNAVAILABLE" }, { status: 503 });
  }
}
