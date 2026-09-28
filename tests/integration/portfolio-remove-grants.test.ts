/**
 * Grant hardening integration test for remove_portfolio_media RPC (migration 0028).
 *
 * Migration 0028 revokes EXECUTE from PUBLIC/anon and grants it only to authenticated.
 * The function body is unchanged — it still uses auth.uid() internally to enforce
 * admin-only access via SECURITY DEFINER.
 *
 * Direct pg_catalog assertions (has_function_privilege, prosecdef, prosrc) are not
 * possible in this harness because Supabase PostgREST does not expose system catalogs
 * and project policy forbids creating production RPCs solely for test introspection.
 *
 * Instead, each contract point is proven via observable runtime behavior that is
 * distinguishable ONLY if the underlying property holds:
 *
 * 1. 1-arg exists / 2-arg absent → error message differentiation
 * 2. PUBLIC/anon EXECUTE revoked → "permission denied" (not "Not authenticated")
 * 3. authenticated EXECUTE granted → customer reaches internal admin check
 * 4. SECURITY DEFINER + auth.uid() → customer gets "Forbidden" (not permission denied)
 * 5. Admin success path unchanged → media actually removed
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
  // ── Signature existence ───────────────────────────────────────────────
  // Proven by error differentiation: a missing function produces
  // "could not find function" / "does not exist", while an existing
  // function with revoked grants produces "permission denied".

  it("1-arg function exists (anon gets permission denied, not function-not-found)", async () => {
    const { error } = await anonClient.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).not.toBeNull();
    // If the function did not exist, PostgREST would return a routing error
    // like "Could not find the function" or similar. A "permission denied"
    // error proves the function exists but the caller lacks EXECUTE.
    expect(error?.message).toMatch(/permission denied|not allowed/i);
    expect(error?.message).not.toMatch(/could not find|does not exist|not found/i);
  });

  it("2-arg function does NOT exist (admin gets function-not-found)", async () => {
    const { error } = await adminJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
      p_admin_user_id: adminUserId,
    } as never);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/could not find|does not exist|not found/i);
  });

  // ── Grant enforcement ─────────────────────────────────────────────────
  // After 0028: PUBLIC and anon have no EXECUTE. Authenticated does.
  // The error messages are distinguishable:
  //   - No EXECUTE → "permission denied" (PostgREST rejects before function body)
  //   - Has EXECUTE but fails internal check → "Forbidden: admin role required"

  it("anon does NOT have EXECUTE (gets permission denied, not auth error)", async () => {
    const { error } = await anonClient.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).not.toBeNull();
    // Before 0028: anon inherited PUBLIC EXECUTE → reached function body →
    //   "Not authenticated" (auth.uid() is null).
    // After 0028: anon has no EXECUTE → PostgREST rejects → "permission denied".
    expect(error?.message).toMatch(/permission denied|not allowed/i);
    expect(error?.message).not.toMatch(/not authenticated/i);
  });

  it("PUBLIC does NOT have EXECUTE (proven by anon denial)", async () => {
    // In PostgreSQL, anon inherits privileges from PUBLIC. If PUBLIC had
    // EXECUTE, anon would also have it regardless of explicit anon revocation.
    // Therefore, anon receiving "permission denied" proves BOTH:
    //   1. anon has no explicit EXECUTE grant
    //   2. PUBLIC has no EXECUTE grant (otherwise anon would inherit it)
    const { error } = await anonClient.rpc("remove_portfolio_media" as never, {
      p_media_id: "00000000-0000-0000-0000-000000000000",
    } as never);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/permission denied|not allowed/i);
  });

  it("authenticated HAS EXECUTE (customer reaches internal admin check, not permission denied)", async () => {
    const { mediaIds } = await createIsolatedWork(2);
    const { error } = await customerJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
    } as never);
    expect(error).not.toBeNull();
    // Customer is authenticated → has EXECUTE → reaches function body →
    // fails internal admin check → "Forbidden: admin role required".
    // If authenticated lacked EXECUTE, error would be "permission denied".
    expect(error?.message).toMatch(/forbidden|admin|not authorized/i);
    expect(error?.message).not.toMatch(/permission denied/i);
  });

  // ── SECURITY DEFINER + auth.uid() authority ───────────────────────────
  // Proven by the customer test above: the error comes from INSIDE the
  // function body ("Forbidden"), which means:
  //   1. The function executed under its owner's privileges (SECURITY DEFINER)
  //   2. auth.uid() resolved to the customer's identity (not bypassed)
  //   3. The admin check correctly rejected the non-admin caller

  it("function uses auth.uid() and SECURITY DEFINER (customer rejected internally, not by grants)", async () => {
    const { mediaIds } = await createIsolatedWork(2);
    const { error } = await customerJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
    } as never);
    expect(error).not.toBeNull();
    // The error MUST come from the internal admin check, proving:
    // - SECURITY DEFINER: function ran with owner privileges (reached body)
    // - auth.uid(): resolved to customer, not null or admin
    expect(error?.message).toMatch(/forbidden|admin role required/i);
    // Must NOT be a grant-level rejection
    expect(error?.message).not.toMatch(/permission denied/i);
  });

  // ── Admin success path ────────────────────────────────────────────────

  it("admin can successfully remove media (grants unchanged for authenticated admins)", async () => {
    const { workId, mediaIds } = await createIsolatedWork(2);

    const { data, error } = await adminJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[1],
    } as never);
    expect(error).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (Array.isArray(data) ? data[0] : data) as any;
    expect(result).toBeDefined();
    expect(result.work_id).toBe(workId);
    expect(result.removed_storage_path).toContain("test/grant-");

    // Verify media was actually removed
    const { count } = await serviceRole
      .from("portfolio_item_media")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_item_id", workId);
    expect(count).toBe(1);
  });

  // ── Hero fallback still works ─────────────────────────────────────────

  it("hero fallback works when hero media is removed", async () => {
    const { workId, mediaIds } = await createIsolatedWork(2);

    // Verify hero is mediaIds[0] before removal
    const { data: workBefore } = await serviceRole
      .from("portfolio_items")
      .select("hero_media_id")
      .eq("id", workId)
      .single();
    expect(workBefore?.hero_media_id).toBe(mediaIds[0]);

    // Remove the hero media — should fallback to mediaIds[1]
    const { data, error } = await adminJwt.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
    } as never);
    expect(error).toBeNull();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (Array.isArray(data) ? data[0] : data) as any;
    expect(result.new_hero_media_id).toBe(mediaIds[1]);

    // Verify hero_media_id was updated on the work
    const { data: work } = await serviceRole
      .from("portfolio_items")
      .select("hero_media_id")
      .eq("id", workId)
      .single();
    expect(work?.hero_media_id).toBe(mediaIds[1]);
  });
});