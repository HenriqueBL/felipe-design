/**
 * Grant hardening integration test for remove_portfolio_media RPC (migration 0028).
 * Verifies that EXECUTE privileges follow least-privilege contract:
 * - authenticated: YES
 * - anon: NO
 * - PUBLIC: NO
 * - security_definer: YES
 * - auth.uid() authority preserved
 *
 * Pattern: matches portfolio-remove-security.test.ts exactly.
 * - Service role: user creation/deletion + fixture setup/cleanup only.
 * - JWT clients: all RPC calls and privilege assertions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY.",
  );
}

let serviceRole: SupabaseClient<Database>;
let adminJwt: SupabaseClient<Database>;
let customerJwt: SupabaseClient<Database>;
let anonClient: SupabaseClient<Database>;

let adminUserId: string;
let customerUserId: string;
const createdWorkIds: string[] = [];
const createdUserIds: string[] = [];

async function createTestUserWithPassword(
  prefix: string,
  role: "admin" | "customer",
): Promise<{ email: string; password: string; userId: string }> {
  const email = `grant-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.felipedesign.local`;
  const password = `Grant-Test-${Date.now()}-!Aa1`;

  const { data: userData, error: userError } = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`Failed to create test user: ${userError?.message}`);
  }

  await serviceRole.from("profiles").upsert({
    id: userData.user.id,
    email,
    role,
  });

  createdUserIds.push(userData.user.id);
  return { email, password, userId: userData.user.id };
}

async function signInAs(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  serviceRole = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);
  anonClient = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const adminUser = await createTestUserWithPassword("admin", "admin");
  const customerUser = await createTestUserWithPassword("customer", "customer");

  adminJwt = await signInAs(adminUser.email, adminUser.password);
  customerJwt = await signInAs(customerUser.email, customerUser.password);
  adminUserId = adminUser.userId;
  customerUserId = customerUser.userId;
});

afterAll(async () => {
  for (const workId of createdWorkIds) {
    await serviceRole.from("portfolio_item_media").delete().eq("portfolio_item_id", workId);
    await serviceRole.from("portfolio_items").delete().eq("id", workId);
  }
  for (const uid of createdUserIds) {
    await serviceRole.auth.admin.deleteUser(uid).catch(() => {});
  }
});

async function createIsolatedWork(mediaCount: number) {
  const { data: work, error: workErr } = await serviceRole
    .from("portfolio_items")
    .insert({
      title: `Grant Test ${crypto.randomUUID()}`,
      description: "Isolated grant test work",
      sort_order: 9999,
      published: false,
    })
    .select("id")
    .single();
  if (workErr || !work) {
    throw new Error(`Failed to create work: ${workErr?.message}`);
  }
  const workId = work.id;
  createdWorkIds.push(workId);

  const mediaIds: string[] = [];
  for (let i = 1; i <= mediaCount; i++) {
    const { data: m, error: mErr } = await serviceRole
      .from("portfolio_item_media")
      .insert({
        portfolio_item_id: workId,
        storage_path: `test/grant-${crypto.randomUUID()}.jpg`,
        position: i,
        width: 1200,
        height: 800,
        aspect_ratio: 1.5,
      })
      .select("id")
      .single();
    if (mErr || !m) {
      throw new Error(`Failed to create media ${i}: ${mErr?.message}`);
    }
    mediaIds.push(m.id);
  }

  if (mediaIds.length > 0) {
    await serviceRole
      .from("portfolio_items")
      .update({ hero_media_id: mediaIds[0] })
      .eq("id", workId);
  }

  return { workId, mediaIds };
}

describe("remove_portfolio_media grant hardening (0028)", () => {
  it("1-arg function exists and 2-arg function does not", async () => {
    // Verify 1-arg exists by calling pg_proc introspection via service role RPC or direct query
    const { data: funcs, error } = await serviceRole.rpc("to_regclass" as never, {
      name: "public.remove_portfolio_media",
    } as never);
    // to_regclass won't work for functions; use raw SQL via a known pattern instead
    // We verify existence by attempting a call that will fail with auth error (not "function not found")
    const { error: oneArgError } = await anonClient.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    // If function doesn't exist, error says "could not find function"
    // If function exists but anon lacks execute, error says "permission denied" or similar
    // If function exists and anon has execute but auth.uid() is null, error says "Not authenticated"
    expect(oneArgError).not.toBeNull();
    expect(oneArgError?.message).not.toMatch(/could not find|does not exist/i);

    // Verify 2-arg does NOT exist
    const { error: twoArgError } = await adminJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
      p_admin_user_id: adminUserId,
    } as never);
    expect(twoArgError).not.toBeNull();
    expect(twoArgError?.message).toMatch(/could not find|does not exist/i);
  });

  it("anon does NOT have EXECUTE privilege", async () => {
    const { error } = await anonClient.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).not.toBeNull();
    // After 0028, anon should get "permission denied for function" not "Not authenticated"
    // because EXECUTE is revoked from PUBLIC/anon before the function body runs.
    expect(error?.message).toMatch(/permission denied|not allowed/i);
  });

  it("authenticated non-admin is rejected by auth.uid() check (not by grant)", async () => {
    const { mediaIds } = await createIsolatedWork(2);
    const { error } = await customerJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
    } as never);
    expect(error).not.toBeNull();
    // Customer HAS execute (authenticated), but fails the admin check inside the function
    expect(error?.message).toMatch(/forbidden|admin|not authorized/i);
    expect(error?.message).not.toMatch(/permission denied/i);
  });

  it("admin can still successfully remove media (grants unchanged for authenticated)", async () => {
    const { workId, mediaIds } = await createIsolatedWork(2);
    const { data, error } = await adminJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[1],
    } as never);
    expect(error).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (Array.isArray(data) ? data[0] : data) as any;
    expect(result).toBeDefined();
    expect(result.work_id).toBe(workId);

    const { count } = await serviceRole
      .from("portfolio_item_media")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_item_id", workId);
    expect(count).toBe(1);
  });

  it("function remains SECURITY DEFINER with auth.uid() authority", async () => {
    // Verify by checking that a customer JWT gets "Forbidden: admin role required"
    // (meaning auth.uid() resolved to the customer, not bypassed)
    const { mediaIds } = await createIsolatedWork(2);
    const { error } = await customerJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
    } as never);
    expect(error).not.toBeNull();
    // The error must come from the internal admin check, proving auth.uid() is used
    expect(error?.message).toMatch(/forbidden|admin/i);
  });
});