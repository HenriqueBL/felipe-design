/**
 * Integration tests for portfolio admin, media model, RLS and featured logic.
 * Runs against real DEV Supabase (jfsymthtepikfpexzxvk).
 *
 * Coverage:
 * - admin CRUD with REAL JWT (not service_role)
 * - customer JWT write rejection (RLS)
 * - anon read/write policies
 * - publication visibility
 * - single featured guarantee + atomic swap via RPC
 * - media constraint (image OR before+after)
 * - legacy compatibility
 * - storage cleanup safety (legacy after == old image)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY. See tests/integration/README.md.",
  );
}

// Service role used ONLY for fixture setup/cleanup and user creation.
// NEVER used for RLS assertions.
let serviceRole: SupabaseClient;
let anon: SupabaseClient;

// Real JWT clients for RLS testing
let adminJwt: SupabaseClient;
let customerJwt: SupabaseClient;

const createdIds: string[] = [];
const createdUserIds: string[] = [];

async function createTestUserWithPassword(
  prefix: string,
  role: "admin" | "customer",
): Promise<{ email: string; password: string; userId: string }> {
  const email = `int-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.felipedesign.local`;
  const password = `Int-Test-${Date.now()}-!Aa1`;

  const { data: userData, error: userError } = await serviceRole.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`Failed to create test user: ${userError?.message}`);
  }

  // Ensure profile exists with correct role
  await serviceRole.from("profiles").upsert({
    id: userData.user.id,
    email,
    role,
  });

  createdUserIds.push(userData.user.id);
  return { email, password, userId: userData.user.id };
}

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

beforeAll(async () => {
  serviceRole = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  anon = createClient(SUPABASE_URL, ANON_KEY);

  // Create real users and sign in to get JWT-bearing clients
  const adminUser = await createTestUserWithPassword("admin", "admin");
  const customerUser = await createTestUserWithPassword("customer", "customer");

  adminJwt = await signInAs(adminUser.email, adminUser.password);
  customerJwt = await signInAs(customerUser.email, customerUser.password);
});

beforeEach(async () => {
  // Clear any existing featured=true rows to prevent partial unique index
  // violations between tests.
  await serviceRole
    .from("portfolio_items")
    .update({ featured: false })
    .eq("featured", true);
});

afterAll(async () => {
  // Cleanup portfolio items
  if (createdIds.length > 0) {
    await serviceRole.from("portfolio_items").delete().in("id", createdIds);
  }
  // Cleanup test users
  for (const uid of createdUserIds) {
    await serviceRole.auth.admin.deleteUser(uid).catch(() => {});
  }
});

/** Insert via service_role for fixture setup only. */
async function insertFixture(overrides: Record<string, unknown> = {}) {
  const base = {
    title: `Fixture ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    image_storage_path: `items/fixture-${crypto.randomUUID()}.jpg`,
    before_storage_path: null,
    after_storage_path: null,
    published: false,
    featured: false,
    sort_order: 0,
  };
  const { data, error } = await serviceRole
    .from("portfolio_items")
    .insert({ ...base, ...overrides })
    .select("id")
    .single();
  if (error) throw error;
  createdIds.push(data.id);
  return data;
}

// ─── RLS WITH REAL JWT ───────────────────────────────────────────────

describe("Portfolio — RLS (real JWT)", () => {
  it("admin JWT consegue INSERT portfolio_item", async () => {
    const { data, error } = await adminJwt
      .from("portfolio_items")
      .insert({
        title: "Admin JWT insert",
        image_storage_path: `items/admin-jwt-${crypto.randomUUID()}.jpg`,
        before_storage_path: null,
        after_storage_path: null,
        published: false,
        featured: false,
        sort_order: 0,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) createdIds.push(data.id);
  });

  it("admin JWT consegue UPDATE portfolio_item", async () => {
    const row = await insertFixture();
    const { error } = await adminJwt
      .from("portfolio_items")
      .update({ title: "Updated by admin JWT" })
      .eq("id", row.id);
    expect(error).toBeNull();
  });

  it("admin JWT consegue DELETE portfolio_item", async () => {
    const row = await insertFixture();
    const { error } = await adminJwt
      .from("portfolio_items")
      .delete()
      .eq("id", row.id);
    expect(error).toBeNull();
    // Remove from cleanup list since already deleted
    const idx = createdIds.indexOf(row.id);
    if (idx >= 0) createdIds.splice(idx, 1);
  });

  it("customer JWT NÃO consegue INSERT portfolio_item", async () => {
    const { error } = await customerJwt
      .from("portfolio_items")
      .insert({
        title: "Customer attempt",
        image_storage_path: "items/customer.jpg",
        before_storage_path: null,
        after_storage_path: null,
        published: false,
        featured: false,
        sort_order: 0,
      });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/permission|policy|forbidden/i);
  });

  it("customer JWT NÃO consegue UPDATE portfolio_item (row permanece inalterada)", async () => {
    const originalTitle = `Original ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`;
    const row = await insertFixture({ title: originalTitle });
    const attemptedTitle = `Customer update ${Date.now()}`;

    // Customer tenta atualizar — RLS pode retornar sem erro mas afetar 0 rows
    await customerJwt
      .from("portfolio_items")
      .update({ title: attemptedTitle })
      .eq("id", row.id);

    // Verificar via service_role que o title NÃO mudou
    const { data } = await serviceRole
      .from("portfolio_items")
      .select("title")
      .eq("id", row.id)
      .single();
    expect(data?.title).toBe(originalTitle);
  });

  it("customer JWT NÃO consegue DELETE portfolio_item (row continua existindo)", async () => {
    const row = await insertFixture();

    // Customer tenta deletar — RLS pode retornar sem erro mas afetar 0 rows
    await customerJwt
      .from("portfolio_items")
      .delete()
      .eq("id", row.id);

    // Verificar via service_role que a row AINDA existe
    const { data } = await serviceRole
      .from("portfolio_items")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    expect(data?.id).toBe(row.id);
  });

  it("anon NÃO consegue INSERT portfolio_item", async () => {
    const { error } = await anon.from("portfolio_items").insert({
      title: "Anon attempt",
      image_storage_path: "items/anon.jpg",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/permission|policy|forbidden/i);
  });

  it("published é legível por anon", async () => {
    const row = await insertFixture({ published: true });
    const { data, error } = await anon
      .from("portfolio_items")
      .select("id, title")
      .eq("id", row.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(row.id);
  });

  it("unpublished NÃO é visível para anon", async () => {
    const row = await insertFixture({ published: false });
    const { data, error } = await anon
      .from("portfolio_items")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

// ─── FEATURED RPC WITH REAL JWT ──────────────────────────────────────

describe("Portfolio — Featured RPC (real JWT)", () => {
  it("admin JWT consegue marcar item como featured via RPC", async () => {
    const row = await insertFixture({ published: true });
    const { error } = await adminJwt.rpc("set_portfolio_featured", {
      target_id: row.id,
    });
    expect(error).toBeNull();

    const { data } = await serviceRole
      .from("portfolio_items")
      .select("featured")
      .eq("id", row.id)
      .single();
    expect(data?.featured).toBe(true);
  });

  it("customer JWT NÃO consegue chamar set_portfolio_featured", async () => {
    const row = await insertFixture({ published: true });
    const { error } = await customerJwt.rpc("set_portfolio_featured", {
      target_id: row.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/forbidden|admin|permission/i);
  });

  it("anon NÃO consegue chamar set_portfolio_featured", async () => {
    const row = await insertFixture({ published: true });
    const { error } = await anon.rpc("set_portfolio_featured", {
      target_id: row.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/forbidden|admin|permission/i);
  });

  it("swap A→B via RPC: A=false, B=true (atómico)", async () => {
    const a = await insertFixture({ published: true });
    const b = await insertFixture({ published: true });

    const { error: e1 } = await adminJwt.rpc("set_portfolio_featured", {
      target_id: a.id,
    });
    expect(e1).toBeNull();

    const { error: e2 } = await adminJwt.rpc("set_portfolio_featured", {
      target_id: b.id,
    });
    expect(e2).toBeNull();

    const { data: items } = await serviceRole
      .from("portfolio_items")
      .select("id, featured")
      .in("id", [a.id, b.id]);

    const aRow = items?.find((r) => r.id === a.id);
    const bRow = items?.find((r) => r.id === b.id);
    expect(aRow?.featured).toBe(false);
    expect(bRow?.featured).toBe(true);
  });

  it("partial unique index garante apenas UM featured=true", async () => {
    const a = await insertFixture({ published: true, featured: true });
    const { error } = await serviceRole.from("portfolio_items").insert({
      title: "Second featured attempt",
      image_storage_path: `items/dup-${crypto.randomUUID()}.jpg`,
      featured: true,
      published: true,
      before_storage_path: null,
      after_storage_path: null,
      sort_order: 0,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/unique|duplicate|portfolio_items_featured_uq/i);
  });

  it("unpublish de featured faz consulta pública não retornar o item", async () => {
    const row = await insertFixture({ published: true, featured: true });
    await serviceRole
      .from("portfolio_items")
      .update({ published: false })
      .eq("id", row.id);

    const { data } = await anon
      .from("portfolio_items")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

// ─── MEDIA CONSTRAINT (migration 0021) ───────────────────────────────

describe("Portfolio — Media Constraint (migration 0021)", () => {
  it("item com apenas image_storage_path é válido", async () => {
    const row = await insertFixture({
      image_storage_path: `items/only-${crypto.randomUUID()}.jpg`,
      before_storage_path: null,
      after_storage_path: null,
    });
    expect(row.id).toBeTruthy();
  });

  it("item legacy com before+after é válido", async () => {
    const row = await insertFixture({
      image_storage_path: null,
      before_storage_path: `items/before-${crypto.randomUUID()}.jpg`,
      after_storage_path: `items/after-${crypto.randomUUID()}.jpg`,
    });
    expect(row.id).toBeTruthy();
  });

  it("item sem nenhuma mídia é REJEITADO pela constraint", async () => {
    const { error } = await serviceRole.from("portfolio_items").insert({
      title: "No media",
      image_storage_path: null,
      before_storage_path: null,
      after_storage_path: null,
      published: false,
      featured: false,
      sort_order: 0,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/portfolio_items_media_required|check/i);
  });

  it("item com apenas before (sem after) é REJEITADO", async () => {
    const { error } = await serviceRole.from("portfolio_items").insert({
      title: "Only before",
      image_storage_path: null,
      before_storage_path: "items/before-only.jpg",
      after_storage_path: null,
      published: false,
      featured: false,
      sort_order: 0,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/portfolio_items_media_required|check/i);
  });
});

// ─── LEGACY COMPATIBILITY ────────────────────────────────────────────

describe("Portfolio — Legacy compatibility", () => {
  it("legacy rows permanecem válidos após migration 0021", async () => {
    const row = await insertFixture({
      image_storage_path: null,
      before_storage_path: `items/leg-b-${crypto.randomUUID()}.jpg`,
      after_storage_path: `items/leg-a-${crypto.randomUUID()}.jpg`,
    });

    const { error } = await serviceRole
      .from("portfolio_items")
      .update({ title: "Legacy updated" })
      .eq("id", row.id);
    expect(error).toBeNull();

    const { data } = await serviceRole
      .from("portfolio_items")
      .select("before_storage_path, after_storage_path, image_storage_path")
      .eq("id", row.id)
      .single();
    expect(data?.before_storage_path).toBeTruthy();
    expect(data?.after_storage_path).toBeTruthy();
    expect(data?.image_storage_path).toBeNull();
  });
});

// ─── STORAGE CLEANUP SAFETY ──────────────────────────────────────────

describe("Portfolio — Storage cleanup safety", () => {
  it("old image path NÃO é removível quando after_storage_path ainda referencia (legacy)", async () => {
    // Simula cenário legacy: image=x, after=x
    const sharedPath = `items/shared-${crypto.randomUUID()}.jpg`;
    const row = await insertFixture({
      image_storage_path: sharedPath,
      before_storage_path: null,
      after_storage_path: sharedPath, // same as image
    });

    // Update image to new path (simulating what the action does)
    const newPath = `items/new-${crypto.randomUUID()}.jpg`;
    await serviceRole
      .from("portfolio_items")
      .update({ image_storage_path: newPath })
      .eq("id", row.id);

    // Verify: sharedPath is STILL referenced by after_storage_path
    const { data } = await serviceRole
      .from("portfolio_items")
      .select("id")
      .or(
        `image_storage_path.eq.${sharedPath},before_storage_path.eq.${sharedPath},after_storage_path.eq.${sharedPath}`,
      )
      .limit(1);
    expect(data?.length).toBeGreaterThan(0);
    // => safeRemoveStorageObject should NOT delete sharedPath
  });

  it("old image path É removível quando nenhum row referencia", async () => {
    const orphanPath = `items/orphan-${crypto.randomUUID()}.jpg`;
    const row = await insertFixture({
      image_storage_path: orphanPath,
      before_storage_path: null,
      after_storage_path: null,
    });

    // Update image to new path
    const newPath = `items/new-orphan-${crypto.randomUUID()}.jpg`;
    await serviceRole
      .from("portfolio_items")
      .update({ image_storage_path: newPath })
      .eq("id", row.id);

    // Verify: orphanPath is NOT referenced anywhere
    const { data } = await serviceRole
      .from("portfolio_items")
      .select("id")
      .or(
        `image_storage_path.eq.${orphanPath},before_storage_path.eq.${orphanPath},after_storage_path.eq.${orphanPath}`,
      )
      .limit(1);
    expect(data?.length ?? 0).toBe(0);
    // => safeRemoveStorageObject CAN safely delete orphanPath
  });
});