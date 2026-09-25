/**
 * Security integration test for remove_portfolio_media RPC.
 * Verifies that the RPC uses auth.uid() internally and rejects
 * non-admin callers — preventing privilege escalation via
 * caller-supplied admin UUID (fixed in migration 0027).
 *
 * Pattern: matches portfolio-admin.test.ts exactly.
 * - Service role: user creation/deletion + fixture setup/cleanup only.
 * - JWT clients: all RPC calls and RLS-gated assertions.
 * - Each test creates isolated data to prevent cross-test interference.
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

let adminUserId: string;
let customerUserId: string;
const createdWorkIds: string[] = [];
const createdUserIds: string[] = [];

async function createTestUserWithPassword(
  prefix: string,
  role: "admin" | "customer",
): Promise<{ email: string; password: string; userId: string }> {
  const email = `sec-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.felipedesign.local`;
  const password = `Sec-Test-${Date.now()}-!Aa1`;

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

/** Create an isolated work with N media items using service role (fixture setup). */
async function createIsolatedWork(mediaCount: number) {
  const { data: work, error: workErr } = await serviceRole
    .from("portfolio_items")
    .insert({
      title: `Security Test ${crypto.randomUUID()}`,
      description: "Isolated test work",
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
        storage_path: `test/sec-${crypto.randomUUID()}.jpg`,
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

it("only the secure 1-arg signature exists (no vulnerable 2-arg version)", async () => {
  const { mediaIds } = await createIsolatedWork(2);

  // Attempt to call the old 2-arg signature — must fail because it was dropped
  const { error: oldSigError } = await adminJwt.rpc(
    "remove_portfolio_media" as never,
    { p_media_id: mediaIds[0], p_admin_user_id: adminUserId } as never,
  );
  expect(oldSigError).not.toBeNull();
  expect(oldSigError?.message).toMatch(
    /could not find the function|does not exist/i,
  );
});

it("rejects non-admin caller attempting direct RPC call", async () => {
  const { workId, mediaIds } = await createIsolatedWork(2);

  // Customer JWT calls the secure 1-arg RPC — auth.uid() resolves to customer → rejected
  const { error } = await customerJwt.rpc("remove_portfolio_media" as never, {
    p_media_id: mediaIds[0],
  } as never);
  expect(error).toBeTruthy();
  expect(error?.message).toMatch(/forbidden|admin|not authorized/i);

  // Verify media was NOT removed
  const { count } = await serviceRole
    .from("portfolio_item_media")
    .select("id", { count: "exact", head: true })
    .eq("portfolio_item_id", workId);
  expect(count).toBe(2);
});

it("admin can successfully remove media via 1-arg RPC", async () => {
  const { workId, mediaIds } = await createIsolatedWork(2);

  const { data, error } = await adminJwt.rpc("remove_portfolio_media" as never, {
    p_media_id: mediaIds[1],
  } as never);
  expect(error).toBeNull();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC return type not in generated types
  const result = (Array.isArray(data) ? data[0] : data) as any;
  expect(result).toBeDefined();
  expect(result.work_id).toBe(workId);
  expect(result.removed_storage_path).toContain("test/sec-");

  // Verify media was actually removed
  const { count } = await serviceRole
    .from("portfolio_item_media")
    .select("*", { count: "exact", head: true })
    .eq("portfolio_item_id", workId);
  expect(count).toBe(1);
});

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC return type not in generated types
  const result = (Array.isArray(data) ? data[0] : data) as any;
  expect(result.new_hero_media_id).not.toBeNull();
  expect(result.new_hero_media_id).not.toBe(mediaIds[0]);
  expect(result.new_hero_media_id).toBe(mediaIds[1]);

  // Verify hero_media_id was updated on the work
  const { data: work } = await serviceRole
    .from("portfolio_items")
    .select("hero_media_id")
    .eq("id", workId)
    .single();
  expect(work?.hero_media_id).toBe(mediaIds[1]);
});