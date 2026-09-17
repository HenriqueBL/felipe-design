import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

// =============================================================================
// SAFETY GUARD: Abort if not pointing to the designated DEV project.
// =============================================================================
const ALLOWED_PROJECT_REF = "jfsymthtepikfpexzxvk";

function extractProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Create .env.test.local with valid dev credentials.`);
  }
  return value;
}

const validatedUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
const validatedAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
const validatedServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);

if (extractProjectRef(validatedUrl) !== ALLOWED_PROJECT_REF) {
  throw new Error("SAFETY GUARD: refusing to run against a non-DEV Supabase project.");
}

const service = createClient(validatedUrl, validatedServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let adminClient: SupabaseClient;

const createdUserIds: string[] = [];

async function createFixtureUser(
  prefix: string,
): Promise<{ userId: string; email: string; password: string }> {
  const email = `${prefix}-${randomBytes(6).toString("hex")}@test.local`;
  const password = "Test1234!x";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error("fixture user failed: " + error?.message);
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email, password };
}

async function signInUser(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(validatedUrl, validatedAnonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("sign-in failed: " + error.message);
  return client;
}

// plans.angles is unique and constrained to 1..3; reuse the shared fixture
// plans (upsert on angles) like the other integration suites do. These plans
// and their prices are shared DEV fixtures and are NOT deleted in afterAll;
// set_plan_price keeps at most one open price per plan+currency, so reruns
// are safe and leave no accumulation behind.
async function createFixturePlan(angles: number): Promise<string> {
  const { data: plan, error } = await service
    .from("plans")
    .upsert({ angles, active: true }, { onConflict: "angles" })
    .select("id")
    .single();
  if (error || !plan) throw new Error("fixture plan failed: " + error.message);
  return plan.id;
}

async function countOpenPrices(
  planId: string,
  currency: "BRL" | "USD",
): Promise<number> {
  const { count, error } = await service
    .from("plan_prices")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId)
    .eq("currency", currency)
    .eq("active", true)
    .is("valid_until", null);
  if (error) throw new Error("count open prices failed: " + error.message);
  return count ?? 0;
}

const ORIGINAL_SETTINGS = {
  dailyCapacity: 4,
  cutoffTime: "17:00",
  timezone: "America/Sao_Paulo",
  minSourcePhotosPerKnife: 3,
  maxSourcePhotosPerKnife: 5,
  maxSourcePhotoSizeMb: 25,
};

beforeAll(async () => {
  const adminFixture = await createFixtureUser("admpr-admin");
  const { error: promoErr } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", adminFixture.userId);
  if (promoErr) throw new Error("promote admin failed: " + promoErr.message);
  adminClient = await signInUser(adminFixture.email, adminFixture.password);
});

afterAll(async () => {
  await adminClient.rpc("update_app_settings", {
    p_daily_capacity: ORIGINAL_SETTINGS.dailyCapacity,
    p_cutoff_time: ORIGINAL_SETTINGS.cutoffTime,
    p_timezone: ORIGINAL_SETTINGS.timezone,
    p_min_source_photos_per_knife: ORIGINAL_SETTINGS.minSourcePhotosPerKnife,
    p_max_source_photos_per_knife: ORIGINAL_SETTINGS.maxSourcePhotosPerKnife,
    p_max_source_photo_size_mb: ORIGINAL_SETTINGS.maxSourcePhotoSizeMb,
  });
  for (const userId of createdUserIds) {
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {
      // best-effort
    }
  }
});

describe("plan price integrity", () => {
  it("concurrent set_plan_price calls on the same plan/currency end consistent", async () => {
    const planId = await createFixturePlan(1);

    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) =>
        adminClient.rpc("set_plan_price", {
          p_plan_id: planId,
          p_currency: "BRL",
          p_amount_cents: 1000 + i * 10,
        }),
      ),
    );

    for (const result of attempts) {
      expect(result.status).toBe("fulfilled");
      if (result.status === "fulfilled") {
        expect(result.value.error).toBeNull();
      }
    }

    expect(await countOpenPrices(planId, "BRL")).toBe(1);

    const { data: openRow, error } = await service
      .from("plan_prices")
      .select("*")
      .eq("plan_id", planId)
      .eq("currency", "BRL")
      .eq("active", true)
      .is("valid_until", null)
      .maybeSingle();
    expect(error).toBeNull();
    expect(openRow).not.toBeNull();

    const submitted = new Set([1000, 1010, 1020, 1030, 1040, 1050]);
    expect(submitted.has(openRow!.amount_cents)).toBe(true);
  });

  it("successive set_plan_price calls keep exactly one open price", async () => {
    const planId = await createFixturePlan(2);

    const { error: e1 } = await adminClient.rpc("set_plan_price", {
      p_plan_id: planId,
      p_currency: "BRL",
      p_amount_cents: 2000,
    });
    expect(e1).toBeNull();
    const { error: e2 } = await adminClient.rpc("set_plan_price", {
      p_plan_id: planId,
      p_currency: "BRL",
      p_amount_cents: 2500,
    });
    expect(e2).toBeNull();

    expect(await countOpenPrices(planId, "BRL")).toBe(1);

    const { data: openRow, error } = await service
      .from("plan_prices")
      .select("*")
      .eq("plan_id", planId)
      .eq("currency", "BRL")
      .eq("active", true)
      .is("valid_until", null)
      .maybeSingle();
    expect(error).toBeNull();
    expect(openRow).not.toBeNull();
    expect(openRow!.amount_cents).toBe(2500);

    // All closed rows (if any) must be inactive and point before the open row.
    const { data: closedRows, error: closedErr } = await service
      .from("plan_prices")
      .select("*")
      .eq("plan_id", planId)
      .eq("currency", "BRL")
      .eq("active", false)
      .not("valid_until", "is", null);
    expect(closedErr).toBeNull();
    for (const closed of closedRows ?? []) {
      expect(closed.valid_until).not.toBeNull();
      if (closed.valid_until && openRow!.valid_from) {
        expect(closed.valid_until < openRow!.valid_from).toBe(true);
      }
    }
  });

  it("open price invariant is enforced per currency", async () => {
    const planId = await createFixturePlan(3);

    const { error: e1 } = await adminClient.rpc("set_plan_price", {
      p_plan_id: planId,
      p_currency: "BRL",
      p_amount_cents: 3000,
    });
    expect(e1).toBeNull();
    const { error: e2 } = await adminClient.rpc("set_plan_price", {
      p_plan_id: planId,
      p_currency: "USD",
      p_amount_cents: 600,
    });
    expect(e2).toBeNull();

    expect(await countOpenPrices(planId, "BRL")).toBe(1);
    expect(await countOpenPrices(planId, "USD")).toBe(1);
  });

  it("non-admin cannot set plan price", async () => {
    const regular = await createFixtureUser("admpr-reg");
    const regularClient = await signInUser(regular.email, regular.password);
    const planId = await createFixturePlan(1);

    const { error } = await regularClient.rpc("set_plan_price", {
      p_plan_id: planId,
      p_currency: "BRL",
      p_amount_cents: 4000,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain("FORBIDDEN");
  });

  it("valid_from derives from app_settings.timezone, not session current_date", async () => {
    const planId = await createFixturePlan(2);

    const TIMEZONE = "Pacific/Kiritimati";
    const { error: tzErr } = await adminClient.rpc("update_app_settings", {
      p_daily_capacity: ORIGINAL_SETTINGS.dailyCapacity,
      p_cutoff_time: ORIGINAL_SETTINGS.cutoffTime,
      p_timezone: TIMEZONE,
      p_min_source_photos_per_knife: ORIGINAL_SETTINGS.minSourcePhotosPerKnife,
      p_max_source_photos_per_knife: ORIGINAL_SETTINGS.maxSourcePhotosPerKnife,
      p_max_source_photo_size_mb: ORIGINAL_SETTINGS.maxSourcePhotoSizeMb,
    });
    expect(tzErr).toBeNull();

    const expectedDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    try {
      const { error } = await adminClient.rpc("set_plan_price", {
        p_plan_id: planId,
        p_currency: "BRL",
        p_amount_cents: 5000,
      });
      expect(error).toBeNull();

      const { data: price, error: readErr } = await service
        .from("plan_prices")
        .select("valid_from")
        .eq("plan_id", planId)
        .eq("currency", "BRL")
        .eq("active", true)
        .is("valid_until", null)
        .maybeSingle();
      expect(readErr).toBeNull();
      expect(price).not.toBeNull();
      expect(price!.valid_from).toBe(expectedDate);
    } finally {
      // Kiritimati (UTC+14) produces a valid_from in the DEV-local future.
      // Leaving that row open would make later set_plan_price calls under
      // America/Sao_Paulo close it with valid_until < valid_from (violating
      // plan_prices_no_overlap). Restore the previous state: drop the
      // future-dated row and reopen the most recent closed one.
      const { error: delErr } = await service
        .from("plan_prices")
        .delete()
        .eq("plan_id", planId)
        .eq("currency", "BRL")
        .is("valid_until", null)
        .eq("valid_from", expectedDate);
      expect(delErr).toBeNull();

      const { data: lastClosed, error: closedErr } = await service
        .from("plan_prices")
        .select("id")
        .eq("plan_id", planId)
        .eq("currency", "BRL")
        .eq("active", false)
        .order("valid_from", { ascending: false })
        .limit(1)
        .maybeSingle();
      expect(closedErr).toBeNull();
      if (lastClosed) {
        const { error: reopenErr } = await service
          .from("plan_prices")
          .update({ active: true, valid_until: null })
          .eq("id", lastClosed.id);
        expect(reopenErr).toBeNull();
      }
    }
  });
});