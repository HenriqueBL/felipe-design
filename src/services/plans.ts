import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Currency, PlanPriceRow, PlanRow } from "@/types/database";

export interface PlanWithPrices extends PlanRow {
  prices: PlanPriceRow[];
}

export async function listPlans(): Promise<PlanWithPrices[]> {
  const supabase = await createSupabaseServerClient();

  const [plansResult, pricesResult] = await Promise.all([
    supabase.from("plans").select("*").order("angles"),
    supabase
      .from("plan_prices")
      .select("*")
      .order("valid_from", { ascending: false }),
  ]);

  if (plansResult.error) {
    throw new Error("Failed to list plans: " + plansResult.error.message);
  }
  if (pricesResult.error) {
    throw new Error("Failed to list plan prices: " + pricesResult.error.message);
  }

  const pricesByPlan = new Map<string, PlanPriceRow[]>();
  for (const price of pricesResult.data ?? []) {
    const list = pricesByPlan.get(price.plan_id) ?? [];
    list.push(price);
    pricesByPlan.set(price.plan_id, list);
  }

  return (plansResult.data ?? []).map((plan) => ({
    ...plan,
    prices: pricesByPlan.get(plan.id) ?? [],
  }));
}

export interface UpdatePlanPriceInput {
  planId: string;
  currency: Currency;
  amountCents: number;
}

export async function updatePlanPrice(input: UpdatePlanPriceInput): Promise<PlanPriceRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_plan_price", {
    p_plan_id: input.planId,
    p_currency: input.currency,
    p_amount_cents: input.amountCents,
  });

  if (error) {
    throw new Error("Failed to update plan price: " + error.message);
  }
  return data;
}

export async function setPlanActive(planId: string, active: boolean): Promise<PlanRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_plan_active", {
    p_plan_id: planId,
    p_active: active,
  });

  if (error) {
    throw new Error("Failed to update plan status: " + error.message);
  }
  return data;
}
