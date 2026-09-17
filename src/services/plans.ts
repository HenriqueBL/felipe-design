import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Currency, PlanPriceRow, PlanRow } from "@/types/database";

export interface PlanWithPrices extends PlanRow {
  prices: PlanPriceRow[];
}

export interface ActivePlan {
  id: string;
  angles: number;
  prices: Record<Currency, number | null>;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function listPlans(): Promise<PlanWithPrices[]> {
  const supabase = await createSupabaseServerClient();

  const [plansResult, pricesResult] = await Promise.all([
    supabase.from("plans").select("*").order("angles"),
    supabase.from("plan_prices").select("*").order("valid_from", { ascending: false }),
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

export async function listActivePlans(): Promise<ActivePlan[]> {
  const supabase = await createSupabaseServerClient();

  const [plansResult, pricesResult] = await Promise.all([
    supabase.from("plans").select("*").eq("active", true).order("angles"),
    supabase.from("plan_prices").select("*").eq("active", true),
  ]);

  if (plansResult.error) {
    throw new Error("Failed to list active plans: " + plansResult.error.message);
  }
  if (pricesResult.error) {
    throw new Error("Failed to list active prices: " + pricesResult.error.message);
  }

  const today = todayISO();
  const plans = new Map<string, ActivePlan>();
  for (const plan of plansResult.data ?? []) {
    plans.set(plan.id, {
      id: plan.id,
      angles: plan.angles,
      prices: { BRL: null, USD: null },
    });
  }

  for (const price of pricesResult.data ?? []) {
    const entry = plans.get(price.plan_id);
    if (!entry) {
      continue;
    }
    const validFromOk = price.valid_from <= today;
    const validUntilOk = price.valid_until === null || price.valid_until >= today;
    if (validFromOk && validUntilOk && entry.prices[price.currency] === null) {
      entry.prices[price.currency] = price.amount_cents;
    }
  }

  return Array.from(plans.values());
}

export interface PlanWithPrice {
  plan: PlanRow;
  priceCents: number;
}

export async function getActivePlanWithPrice(
  planId: string,
  currency: Currency,
): Promise<PlanWithPrice | null> {
  const supabase = await createSupabaseServerClient();
  const { data: plan, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("id", planId)
    .eq("active", true)
    .maybeSingle();

  if (planError || !plan) {
    return null;
  }

  const today = todayISO();
  const { data: price, error: priceError } = await supabase
    .from("plan_prices")
    .select("*")
    .eq("plan_id", planId)
    .eq("currency", currency)
    .eq("active", true)
    .lte("valid_from", today)
    .or("valid_until.is.null,valid_until.gte." + today)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priceError || !price) {
    return null;
  }

  return { plan, priceCents: price.amount_cents };
}

export interface UpdatePlanPriceInput {
  planId: string;
  currency: Currency;
  amountCents: number;
}

export class PlanPriceError extends Error {
  constructor(
    public readonly code:
      | "FORBIDDEN"
      | "INVALID_AMOUNT"
      | "SETTINGS_MISSING"
      | "CONFLICT"
      | "UNKNOWN",
  ) {
    super(code);
    this.name = "PlanPriceError";
  }
}

function mapSetPlanPriceError(rawMessage: string): PlanPriceError {
  if (rawMessage.includes("FORBIDDEN")) return new PlanPriceError("FORBIDDEN");
  if (rawMessage.includes("INVALID_AMOUNT")) {
    return new PlanPriceError("INVALID_AMOUNT");
  }
  if (rawMessage.includes("SETTINGS_MISSING")) {
    return new PlanPriceError("SETTINGS_MISSING");
  }
  if (rawMessage.includes("plan_prices_open_uq")) {
    return new PlanPriceError("CONFLICT");
  }
  return new PlanPriceError("UNKNOWN");
}

export async function updatePlanPrice(input: UpdatePlanPriceInput): Promise<PlanPriceRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_plan_price", {
    p_plan_id: input.planId,
    p_currency: input.currency,
    p_amount_cents: input.amountCents,
  });

  if (error) {
    throw mapSetPlanPriceError(error.message);
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
