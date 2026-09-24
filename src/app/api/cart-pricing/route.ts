import { NextResponse } from "next/server";
import { z } from "zod";
import { getActivePlanWithPrice } from "@/services/plans";
import { fetchDeliveryEstimate } from "@/services/delivery-estimate";
import { extractCountry, resolveMarket } from "@/lib/market";

// O carrinho do browser envia apenas intenção (planId + quantity);
// moeda e preços são resolvidos exclusivamente no servidor com base
// no país do visitante. Nenhum valor monetário do cliente é aceito.
const bodySchema = z.object({
  items: z
    .array(
      z.object({
        planId: z.string().uuid(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(20),
});

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  // Server-authoritative currency resolution based on country
  const country = extractCountry(request.headers);
  const market = resolveMarket(country);
  const currency = market.currency;

  const items = await Promise.all(
    parsed.data.items.map(async (item) => {
      try {
        const plan = await getActivePlanWithPrice(item.planId, currency);
        return {
          planId: item.planId,
          quantity: item.quantity,
          angles: plan ? plan.plan.angles : 0,
          priceCents: plan ? plan.priceCents : null,
        };
      } catch {
        return {
          planId: item.planId,
          quantity: item.quantity,
          angles: 0,
          priceCents: null,
        };
      }
    }),
  );

  // Server-authoritative totalImages: sum of (quantity * angles) per item.
  // The browser must NOT compute this for display or checkout submission.
  const totalImages = items.reduce(
    (sum, item) => sum + item.quantity * item.angles,
    0,
  );

  // Delivery estimate is server-side authoritative. If it fails, we still
  // return pricing — the UI shows "estimate unavailable" without blocking.
  let estimate: Awaited<ReturnType<typeof fetchDeliveryEstimate>> | null = null;
  if (totalImages > 0) {
    try {
      estimate = await fetchDeliveryEstimate(totalImages);
    } catch {
      // Non-fatal: cart checkout renders estimateUnavailable label.
    }
  }

  return NextResponse.json({ items, totalImages, estimate, currency });
}