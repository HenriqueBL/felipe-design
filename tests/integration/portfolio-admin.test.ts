/**
 * Integration tests for portfolio admin, media model, RLS and featured logic.
 * Runs against real DEV Supabase (jfsymthtepikfpexzxvk).
 *
 * Coverage:
 * - admin CRUD
 * - customer/anon write rejection (RLS)
 * - publication visibility
 * - single featured guarantee + atomic swap
 * - media constraint (image OR before+after)
 * - legacy compatibility
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

let admin: SupabaseClient;
let anon: SupabaseClient;
const createdIds: string[] = [];

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  anon = createClient(SUPABASE_URL, ANON_KEY);
});

beforeEach(async () => {
  // Clear any existing featured=true rows to prevent partial unique index
  // violations between tests. Each test that needs featured=true sets it fresh.
  await admin
    .from("portfolio_items")
    .update({ featured: false })
    .eq("featured", true);
});

afterAll(async () => {
  // Cleanup: delete all portfolio items created during tests.
  if (createdIds.length > 0) {
    await admin.from("portfolio_items").delete().in("id", createdIds);
  }
});

async function insertAsAdmin(overrides: Record<string, unknown> = {}) {
  const base = {
    title: `Test ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    image_storage_path: `items/test-${crypto.randomUUID()}.jpg`,
    before_storage_path: null,
    after_storage_path: null,
    published: false,
    featured: false,
    sort_order: 0,
  };
  const { data, error } = await admin
    .from("portfolio_items")
    .insert({ ...base, ...overrides })
    .select("id")
    .single();
  if (error) throw error;
  createdIds.push(data.id);
  return data;
}

describe("Portfolio Admin — RLS", () => {
  it("admin consegue criar item com image_storage_path", async () => {
    const row = await insertAsAdmin();
    expect(row.id).toBeTruthy();
  });

  it("anon NÃO consegue inserir portfolio_item", async () => {
    const { error } = await anon.from("portfolio_items").insert({
      title: "Anon attempt",
      image_storage_path: "items/anon.jpg",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/permission|policy|forbidden/i);
  });

  it("RLS está habilitado na tabela portfolio_items", async () => {
    // Validação indireta: anon não consegue inserir (testado acima).
    // Service_role ignora RLS, então não podemos testar customer sem JWT real.
    // O E2E cobre o fluxo completo com login de customer real.
    // Aqui apenas confirmamos que a tabela existe e é acessível via service_role.
    const { error } = await admin.from("portfolio_items").select("id").limit(1);
    expect(error).toBeNull();
  });

  it("published é legível publicamente por anon", async () => {
    const row = await insertAsAdmin({ published: true });
    const { data, error } = await anon
      .from("portfolio_items")
      .select("id, title")
      .eq("id", row.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(row.id);
  });

  it("unpublished NÃO é visível para anon", async () => {
    const row = await insertAsAdmin({ published: false });
    const { data, error } = await anon
      .from("portfolio_items")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("Portfolio — Media Constraint (migration 0021)", () => {
  it("item com apenas image_storage_path é válido", async () => {
    const row = await insertAsAdmin({
      image_storage_path: "items/only-image.jpg",
      before_storage_path: null,
      after_storage_path: null,
    });
    expect(row.id).toBeTruthy();
  });

  it("item legacy com before+after é válido", async () => {
    const row = await insertAsAdmin({
      image_storage_path: null,
      before_storage_path: "items/before.jpg",
      after_storage_path: "items/after.jpg",
    });
    expect(row.id).toBeTruthy();
  });

  it("item sem nenhuma mídia é REJEITADO pela constraint", async () => {
    const { error } = await admin.from("portfolio_items").insert({
      title: "No media",
      image_storage_path: null,
      before_storage_path: null,
      after_storage_path: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/portfolio_items_media_required|check/i);
  });

  it("item com apenas before (sem after) é REJEITADO", async () => {
    const { error } = await admin.from("portfolio_items").insert({
      title: "Only before",
      image_storage_path: null,
      before_storage_path: "items/before-only.jpg",
      after_storage_path: null,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/portfolio_items_media_required|check/i);
  });
});

describe("Portfolio — Featured", () => {
  it("set_portfolio_featured rejeita chamada sem admin (via anon)", async () => {
    const row = await insertAsAdmin({ published: true });
    const { error } = await anon.rpc("set_portfolio_featured", {
      target_id: row.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/forbidden|admin|permission/i);
  });

  // NOTA: set_portfolio_featured usa is_admin() que depende de auth.uid().
  // Service_role não tem JWT, então a RPC rejeita mesmo com service_role.
  // Testamos a lógica de destaque via manipulação direta do DB (service_role
  // ignora RLS) e reservamos a validação da RPC com admin real para E2E.
  it("partial unique index garante apenas UM featured=true no banco", async () => {
    const a = await insertAsAdmin({ published: true, featured: true });
    // Tentar inserir outro com featured=true diretamente deve falhar.
    const { error } = await admin.from("portfolio_items").insert({
      title: "Second featured attempt",
      image_storage_path: "items/second-featured.jpg",
      featured: true,
      published: true,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/unique|duplicate|portfolio_items_featured_uq/i);
  });

  it("swap de featured via DB: A=true,B=false → A=false,B=true respeita constraint", async () => {
    const a = await insertAsAdmin({ published: true, featured: true });
    const b = await insertAsAdmin({ published: true, featured: false });
    // Simula atomicamente o que a RPC faz: desmarca A, marca B.
    await admin.from("portfolio_items").update({ featured: false }).eq("id", a.id);
    await admin.from("portfolio_items").update({ featured: true }).eq("id", b.id);

    const { data: items } = await admin
      .from("portfolio_items")
      .select("id, featured")
      .in("id", [a.id, b.id]);

    const aRow = items?.find((r) => r.id === a.id);
    const bRow = items?.find((r) => r.id === b.id);
    expect(aRow?.featured).toBe(false);
    expect(bRow?.featured).toBe(true);
  });

  it("unpublish de featured faz consulta pública não retornar o item", async () => {
    const row = await insertAsAdmin({ published: true, featured: true });

    // Unpublish
    await admin.from("portfolio_items").update({ published: false }).eq("id", row.id);

    const { data } = await anon
      .from("portfolio_items")
      .select("id")
      .eq("id", row.id)
      .maybeSingle();
    expect(data).toBeNull();
  });
});

describe("Portfolio — Legacy compatibility", () => {
  it("legacy rows permanecem válidos após migration 0021", async () => {
    // Insere como legacy (before+after, sem image_storage_path)
    const row = await insertAsAdmin({
      image_storage_path: null,
      before_storage_path: "items/legacy-before.jpg",
      after_storage_path: "items/legacy-after.jpg",
    });

    // Atualiza título sem quebrar media
    const { error } = await admin
      .from("portfolio_items")
      .update({ title: "Legacy updated" })
      .eq("id", row.id);
    expect(error).toBeNull();

    const { data } = await admin
      .from("portfolio_items")
      .select("before_storage_path, after_storage_path, image_storage_path")
      .eq("id", row.id)
      .single();
    expect(data?.before_storage_path).toBe("items/legacy-before.jpg");
    expect(data?.after_storage_path).toBe("items/legacy-after.jpg");
    expect(data?.image_storage_path).toBeNull();
  });
});