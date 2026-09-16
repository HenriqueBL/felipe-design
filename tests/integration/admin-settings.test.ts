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

// update_app_settings is SECURITY DEFINER but checks is_admin() on the caller,
// so the tests must invoke it as a signed-in admin user (service_role is FORBIDDEN).
let adminClient: SupabaseClient;

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];

async function createFixtureUser(prefix: string): Promise<{ userId: string; email: string; password: string }> {
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

async function createFixturePlan(): Promise<string> {
  const { data: plan, error } = await service
    .from("plans")
    .upsert({ angles: 1, active: true }, { onConflict: "angles" })
    .select("id")
    .single();
  if (error || !plan) throw new Error("fixture plan failed: " + error.message);
  return plan.id;
}

async function createOrder(client: SupabaseClient, planId: string): Promise<string> {
  const { data, error } = await client.rpc("create_order", {
    p_plan_id: planId,
    p_knife_quantity: 1,
    p_currency: "BRL",
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data) throw new Error("create_order failed: " + error?.message);
  createdOrderIds.push(data.id);
  return data.id;
}

const ORIGINAL = { min: 3, max: 5, size: 25 };
const UPDATED = { min: 4, max: 7, size: 30 };

beforeAll(async () => {
  // update_app_settings checks is_admin() on the caller — sign in as a
  // promoted admin user (service_role gets FORBIDDEN).
  const adminFixture = await createFixtureUser("admset-admin");
  const { error: promoErr } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", adminFixture.userId);
  if (promoErr) throw new Error("promote admin failed: " + promoErr.message);
  adminClient = await signInUser(adminFixture.email, adminFixture.password);

  // Ensure a known baseline.
  const { error } = await adminClient.rpc("update_app_settings", {
    p_daily_capacity: 4,
    p_cutoff_time: "17:00",
    p_timezone: "America/Sao_Paulo",
    p_min_source_photos_per_knife: ORIGINAL.min,
    p_max_source_photos_per_knife: ORIGINAL.max,
    p_max_source_photo_size_mb: ORIGINAL.size,
  });
  if (error) throw new Error("baseline settings failed: " + error.message);
});

afterAll(async () => {
  // Restore baseline settings.
  await adminClient.rpc("update_app_settings", {
    p_daily_capacity: 4,
    p_cutoff_time: "17:00",
    p_timezone: "America/Sao_Paulo",
    p_min_source_photos_per_knife: ORIGINAL.min,
    p_max_source_photos_per_knife: ORIGINAL.max,
    p_max_source_photo_size_mb: ORIGINAL.size,
  });
  for (const orderId of createdOrderIds) {
    await service.from("order_images").delete().eq("order_id", orderId);
    await service.from("orders").delete().eq("id", orderId);
  }
  for (const userId of createdUserIds) {
    try {
      await service.auth.admin.deleteUser(userId);
    } catch {
      // best-effort
    }
  }
});

describe("admin settings — source photo policy (snapshot)", () => {
  it("settings persist via update_app_settings (read back)", async () => {
    const { error } = await adminClient.rpc("update_app_settings", {
      p_daily_capacity: 4,
      p_cutoff_time: "17:00",
      p_timezone: "America/Sao_Paulo",
      p_min_source_photos_per_knife: UPDATED.min,
      p_max_source_photos_per_knife: UPDATED.max,
      p_max_source_photo_size_mb: UPDATED.size,
    });
    expect(error).toBeNull();

    const { data, error: readErr } = await service
      .from("app_settings")
      .select("min_source_photos_per_knife, max_source_photos_per_knife, max_source_photo_size_mb")
      .eq("id", 1)
      .single();
    expect(readErr).toBeNull();
    expect(data!.min_source_photos_per_knife).toBe(UPDATED.min);
    expect(data!.max_source_photos_per_knife).toBe(UPDATED.max);
    expect(data!.max_source_photo_size_mb).toBe(UPDATED.size);
  });

  it("new order created AFTER the settings change snapshots the NEW values", async () => {
    const user = await createFixtureUser("admset");
    const client = await signInUser(user.email, user.password);
    const planId = await createFixturePlan();
    const orderId = await createOrder(client, planId);

    const { data: o, error } = await service
      .from("orders")
      .select("required_source_photos_per_knife, max_source_photos_per_knife, max_source_photo_size_mb")
      .eq("id", orderId)
      .single();
    expect(error).toBeNull();
    expect(o!.required_source_photos_per_knife).toBe(UPDATED.min);
    expect(o!.max_source_photos_per_knife).toBe(UPDATED.max);
    expect(o!.max_source_photo_size_mb).toBe(UPDATED.size);
  });

  it("validation: max < min is rejected by the RPC", async () => {
    const { error } = await adminClient.rpc("update_app_settings", {
      p_daily_capacity: 4,
      p_cutoff_time: "17:00",
      p_timezone: "America/Sao_Paulo",
      p_min_source_photos_per_knife: 6,
      p_max_source_photos_per_knife: 2,
      p_max_source_photo_size_mb: 25,
    });
    expect(error).toBeTruthy();
  });
});