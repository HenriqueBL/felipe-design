import { NextResponse } from "next/server";
import { z } from "zod";

import { getActivePlanWithPrice } from "@/services/plans";
import type { Currency } from "@/types/database";

// O carrinho do browser envia apenas intenção (planId + quantity + moeda);
// este endpoint revalida no servidor o preço vigente e os ângulos de cada
// plano. Nenhum preço/total calculado no cliente é aceito como autoridade.
const bodySchema = z.object({
  currency: z.enum(["BRL", "USD"]),
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

  const currency: Currency = parsed.data.currency;
  const items = await Promise.all(
    parsed.data.items.map(async (item) => {
      try {
        const plan = await getActivePlanWithPrice(item.planId, currency);
        return {
          planId: item.planId,
          angles: plan ? plan.plan.angles : 0,
          priceCents: plan ? plan.priceCents : null,
        };
      } catch {
        return { planId: item.planId, angles: 0, priceCents: null };
      }
    }),
  );

  return NextResponse.json({ items });
}