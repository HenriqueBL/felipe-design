/**
* Atomic integration test for remove_portfolio_media RPC.
* Verifies the RPC executes atomically: hero fallback, position normalization,
* last-media rejection, and non-admin caller rejection.
*
* Pattern: matches portfolio-admin.test.ts exactly.
* - Service role: user creation/deletion + fixture setup/cleanup only.
* - JWT clients: all RPC calls and RLS-gated assertions.
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
let workId: string;
let mediaIds: string[] = [];
const createdWorkIds: string[] = [];
const createdUserIds: string[] = [];

async function createTestUserWithPassword(
  prefix: string,
  role: "admin" | "customer",
): Promise<{ email: string; password: string; userId: string }> {
  const email = `atom-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.felipedesign.local`;
  const password = `Atom-Test-${Date.now()}-!Aa1`;

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

describe("remove_portfolio_media atomic RPC", () => {
  beforeAll(async () => {
    serviceRole = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Create admin user
    const adminUser = await createTestUserWithPassword("admin", "admin");
    adminJwt = await signInAs(adminUser.email, adminUser.password);

    // Create customer user
    const customerUser = await createTestUserWithPassword("customer", "customer");
    customerJwt = await signInAs(customerUser.email, customerUser.password);

    // Create a test work with 3 media items using service role
    const { data: work, error: workErr } = await serviceRole
      .from("portfolio_items")
      .insert({ title: "Atomic Remove Test", published: false, sort_order: 9999 })
      .select("id")
      .single();
    if (workErr || !work) throw new Error("Failed to create work: " + workErr?.message);
    workId = work.id;
    createdWorkIds.push(workId);

    mediaIds = [];
    for (let i = 1; i <= 3; i++) {
      const { data: media, error: mediaErr } = await serviceRole
        .from("portfolio_item_media")
        .insert({
          portfolio_item_id: workId,
          storage_path: `test/atomic-remove-${i}.jpg`,
          position: i,
          width: 800,
          height: 600,
          aspect_ratio: 1.3333,
        })
        .select("id")
        .single();
      if (mediaErr || !media) throw new Error(`Failed to create media ${i}: ` + mediaErr?.message);
      mediaIds.push(media.id);
    }

    // Set hero to media[0] (position 1)
    await serviceRole.from("portfolio_items").update({ hero_media_id: mediaIds[0] }).eq("id", workId);
  });

  afterAll(async () => {
    // Cleanup
    for (const wid of createdWorkIds) {
      await serviceRole.from("portfolio_item_media").delete().eq("portfolio_item_id", wid);
      await serviceRole.from("portfolio_items").delete().eq("id", wid);
    }
    for (const uid of createdUserIds) {
      await serviceRole.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  it("A: remove hero media → fallback to new position 1", async () => {
  // Ensure hero is media[0] (position 1)
  await serviceRole.from("portfolio_items").update({ hero_media_id: mediaIds[0] }).eq("id", workId);

  const { data, error } = await adminJwt.rpc("remove_portfolio_media" as never, {
    p_media_id: mediaIds[0],
  } as never);
  expect(error).toBeNull();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(data) ? data[0] : data) as any;
  expect(row.removed_storage_path).toBe("test/atomic-remove-1.jpg");
  expect(row.work_id).toBe(workId);
  // New hero should be the media now at position 1 (was position 2)
  expect(row.new_hero_media_id).toBeTruthy();
  expect(row.new_hero_media_id).not.toBe(mediaIds[0]);

  // Verify remaining positions are normalized to 1, 2
  const { data: remaining } = await serviceRole
    .from("portfolio_item_media")
    .select("id, position")
    .eq("portfolio_item_id", workId)
    .order("position");
  expect(remaining).toHaveLength(2);
  expect(remaining?.[0]?.position).toBe(1);
  expect(remaining?.[1]?.position).toBe(2);

  // Verify hero_media_id on work matches new position 1
  const { data: work } = await serviceRole
    .from("portfolio_items")
    .select("hero_media_id")
    .eq("id", workId)
    .single();
  expect(work?.hero_media_id).toBe(remaining?.[0]?.id);

  // Update mediaIds for subsequent tests
  mediaIds = (remaining ?? []).map((r) => r.id);
});

it("B: remove non-hero media → hero unchanged, positions normalized", async () => {
  // Hero is currently mediaIds[0] (position 1)
  // Remove mediaIds[1] (position 2)
  const heroBefore = (
    await serviceRole.from("portfolio_items").select("hero_media_id").eq("id", workId).single()
  ).data!.hero_media_id;

  const { data, error } = await adminJwt.rpc("remove_portfolio_media" as never, {
    p_media_id: mediaIds[1],
  } as never);
  expect(error).toBeNull();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (Array.isArray(data) ? data[0] : data) as any;
  expect(row.new_hero_media_id).toBe(heroBefore);

  // Verify only 1 media remains at position 1
  const { data: remaining } = await serviceRole
    .from("portfolio_item_media")
    .select("id, position")
    .eq("portfolio_item_id", workId)
    .order("position");
  expect(remaining).toHaveLength(1);
  expect(remaining?.[0]?.position).toBe(1);

  mediaIds = (remaining ?? []).map((r) => r.id);
});

it("C: remove last media → rejected, no state changed", async () => {
  const { error } = await adminJwt.rpc("remove_portfolio_media" as never, {
    p_media_id: mediaIds[0],
  } as never);
  expect(error).toBeTruthy();
  expect(error?.message).toMatch(/cannot remove.*last|at least 1/i);

  // Verify media still exists
  const { count } = await serviceRole
    .from("portfolio_item_media")
    .select("id", { count: "exact", head: true })
    .eq("portfolio_item_id", workId);
  expect(count).toBe(1);
});

it("D: non-admin caller → rejected", async () => {
  // Call the secure 1-arg RPC with customer JWT — auth.uid() resolves to customer → rejected
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
  expect(count).toBe(1);
});
});