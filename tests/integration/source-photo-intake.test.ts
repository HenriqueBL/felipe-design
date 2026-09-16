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
const MOCK_PAYMENTS = process.env.ENABLE_MOCK_PAYMENTS;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. See tests/integration/README.md.`);
  }
  return value;
}

const validatedUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
const validatedAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
const validatedServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
requireEnv("ENABLE_MOCK_PAYMENTS", MOCK_PAYMENTS);

const detectedRef = extractProjectRef(validatedUrl);
if (detectedRef !== ALLOWED_PROJECT_REF) {
  throw new Error(
    `SAFETY: Integration tests aborted. NEXT_PUBLIC_SUPABASE_URL points to project ref "${detectedRef}" ` +
      `but only "${ALLOWED_PROJECT_REF}" is allowed.`,
  );
}

if (MOCK_PAYMENTS !== "true") {
  throw new Error("SAFETY: ENABLE_MOCK_PAYMENTS must be 'true' for integration tests.");
}

// =============================================================================
// Clients / fixtures (padroes do production-ready.test.ts)
// =============================================================================

function createServiceClient(): SupabaseClient {
  return createClient(validatedUrl, validatedServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function createUserClient(): SupabaseClient {
  return createClient(validatedUrl, validatedAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url") + "Aa1!";
}

function generateEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}@test.felipedesign.local`;
}

interface FixtureUser {
  userId: string;
  email: string;
  password: string;
}

async function createFixtureUser(
  service: SupabaseClient,
  prefix: string,
): Promise<FixtureUser> {
  const email = generateEmail(prefix);
  const password = generatePassword();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw new Error(`Failed to create fixture user: ${error?.message}`);
  }
  return { userId: data.user.id, email, password };
}

async function promoteToAdmin(service: SupabaseClient, userId: string): Promise<void> {
  const { error } = await service.from("profiles").update({ role: "admin" }).eq("id", userId);
  if (error) throw new Error(`Failed to promote: ${error.message}`);
}

async function signInUser(email: string, password: string): Promise<SupabaseClient> {
  const client = createUserClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  return client;
}

async function createFixturePlan(
  adminClient: SupabaseClient,
  angles: number,
): Promise<string> {
  const { data: plan, error: planErr } = await adminClient
    .from("plans")
    .upsert({ angles, active: true }, { onConflict: "angles" })
    .select("id")
    .single();
  if (planErr || !plan) throw new Error(`Plan upsert failed: ${planErr?.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const { data: existingPrice } = await adminClient
    .from("plan_prices")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("currency", "BRL")
    .eq("valid_from", today)
    .maybeSingle();

  if (existingPrice) return plan.id;

  const { error: priceErr } = await adminClient
    .from("plan_prices")
    .insert({
      plan_id: plan.id,
      currency: "BRL",
      amount_cents: 7500,
      valid_from: today,
      active: true,
    });
  if (priceErr) throw new Error(`Price insert failed: ${priceErr.message}`);
  return plan.id;
}

// =============================================================================
// Suite
// =============================================================================

describe("Source Photo Intake (migration 0008)", () => {
  let service: SupabaseClient;
  let adminFixture: FixtureUser;
  let adminClient: SupabaseClient;
  const createdUserIds: string[] = [];

  async function setupOrder(
    prefix: string,
    knifeQty: number,
    planAngles = 1,
  ): Promise<{ user: FixtureUser; client: SupabaseClient; orderId: string }> {
    const user = await createFixtureUser(service, prefix);
    createdUserIds.push(user.userId);
    const client = await signInUser(user.email, user.password);
    const planId = await createFixturePlan(adminClient, planAngles);
    const { data: order, error } = await client.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: knifeQty,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error || !order) throw new Error(`create_order failed: ${error?.message}`);
    return { user, client, orderId: order.id };
  }

  async function register(
    client: SupabaseClient,
    orderId: string,
    userId: string,
    knifeIndex: number,
    n: number,
  ) {
    const results = [];
    for (let i = 0; i < n; i++) {
      const { data, error } = await client.rpc("register_source_image", {
        p_order_id: orderId,
        p_knife_index: knifeIndex,
        p_storage_path: `${userId}/${orderId}/knife-${knifeIndex}/${crypto.randomUUID()}.jpg`,
        p_original_filename: `photo_${i}.jpg`,
      });
      results.push({ data, error });
    }
    return results;
  }

  async function pay(client: SupabaseClient, orderId: string, amountCents = 7500) {
    const { data, error } = await client.rpc("confirm_order_payment", {
      p_order_id: orderId,
      p_provider: "mock",
      p_external_payment_id: "mock_" + orderId,
      p_provider_event_id: "evt_" + crypto.randomUUID(),
      p_amount_cents: amountCents,
      p_currency: "BRL",
    });
    if (error) throw new Error(`confirm_order_payment failed: ${error.message}`);
    return data;
  }

  interface OrderSnapshot {
    production_ready_at: string | null;
    promised_delivery_date: string | null;
    source_image_count: number;
    required_source_photos_per_knife: number;
    max_source_photos_per_knife: number;
    max_source_photo_size_mb: number;
    source_photos_submitted_at: string | null;
    total_images: number;
  }

  async function orderRow(
    client: SupabaseClient,
    orderId: string,
  ): Promise<OrderSnapshot> {
    const { data, error } = await client
      .from("orders")
      .select(
        "production_ready_at, promised_delivery_date, source_image_count, " +
          "required_source_photos_per_knife, max_source_photos_per_knife, " +
          "max_source_photo_size_mb, source_photos_submitted_at, total_images",
      )
      .eq("id", orderId)
      .single();
    if (error) throw new Error(`select order failed: ${error.message}`);
    return data as unknown as OrderSnapshot;
  }

  beforeAll(async () => {
    service = createServiceClient();
    adminFixture = await createFixtureUser(service, "spi-admin");
    createdUserIds.push(adminFixture.userId);
    await promoteToAdmin(service, adminFixture.userId);
    adminClient = await signInUser(adminFixture.email, adminFixture.password);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      try {
        await service.auth.admin.deleteUser(userId);
      } catch {
        // best-effort
      }
    }
  });

  it("create_order snapshota a politica de source photos (3/5/25 default)", async () => {
    const { client, orderId } = await setupOrder("snap", 1);
    const o = await orderRow(client, orderId);
    expect(o.required_source_photos_per_knife).toBe(3);
    expect(o.max_source_photos_per_knife).toBe(5);
    expect(o.max_source_photo_size_mb).toBe(25);
    expect(o.source_photos_submitted_at).toBeNull();
  });

  it("minimo atingido sem submit nao ativa a fila", async () => {
    const { user, client, orderId } = await setupOrder("nosub", 1);
    await pay(client, orderId);
    await register(client, orderId, user.userId, 1, 3);
    const o = await orderRow(client, orderId);
    expect(o.source_image_count).toBe(3);
    expect(o.source_photos_submitted_at).toBeNull();
    expect(o.production_ready_at).toBeNull();
    expect(o.promised_delivery_date).toBeNull();
  });

  it("submit sem pagamento nao ativa a fila", async () => {
    const { user, client, orderId } = await setupOrder("subnopay", 1);
    await register(client, orderId, user.userId, 1, 3);
    const { data, error } = await client.rpc("submit_source_photos", {
      p_order_id: orderId,
    });
    expect(error).toBeNull();
    expect(data!.source_photos_submitted_at).not.toBeNull();
    const o = await orderRow(client, orderId);
    expect(o.production_ready_at).toBeNull();
  });

  it("payment -> photos -> submit ativa a fila", async () => {
    const { user, client, orderId } = await setupOrder("pay-photo-sub", 1);
    await pay(client, orderId);
    await register(client, orderId, user.userId, 1, 3);
    const { data, error } = await client.rpc("submit_source_photos", {
      p_order_id: orderId,
    });
    expect(error).toBeNull();
    expect(data!.production_ready_at).not.toBeNull();
    expect(data!.promised_delivery_date).not.toBeNull();
  });

  it("photos -> submit -> payment ativa a fila na confirmacao", async () => {
    const { user, client, orderId } = await setupOrder("photo-sub-pay", 1);
    await register(client, orderId, user.userId, 1, 3);
    await client.rpc("submit_source_photos", { p_order_id: orderId });
    const o1 = await orderRow(client, orderId);
    expect(o1.production_ready_at).toBeNull();
    await pay(client, orderId);
    const o2 = await orderRow(client, orderId);
    expect(o2.production_ready_at).not.toBeNull();
    expect(o2.promised_delivery_date).not.toBeNull();
  });

  it("2 facas 3+2: submit rejeitado (faca 2 abaixo do minimo)", async () => {
    const { user, client, orderId } = await setupOrder("mk32", 2);
    await register(client, orderId, user.userId, 1, 3);
    await register(client, orderId, user.userId, 2, 2);
    const { error } = await client.rpc("submit_source_photos", {
      p_order_id: orderId,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/MIN_PHOTOS_NOT_MET/i);
    const o = await orderRow(client, orderId);
    expect(o.source_photos_submitted_at).toBeNull();
  });

  it("2 facas 3+3: submit aceito", async () => {
    const { user, client, orderId } = await setupOrder("mk33", 2);
    await register(client, orderId, user.userId, 1, 3);
    await register(client, orderId, user.userId, 2, 3);
    await pay(client, orderId);
    const { data, error } = await client.rpc("submit_source_photos", {
      p_order_id: orderId,
    });
    expect(error).toBeNull();
    expect(data!.source_photos_submitted_at).not.toBeNull();
    expect(data!.production_ready_at).not.toBeNull();
  });

  it("maximo por faca: 6o registro bloqueado (max 5)", async () => {
    const { user, client, orderId } = await setupOrder("maxknife", 1);
    const ok = await register(client, orderId, user.userId, 1, 5);
    ok.forEach((r) => expect(r.error).toBeNull());
    const { error } = await client.rpc("register_source_image", {
      p_order_id: orderId,
      p_knife_index: 1,
      p_storage_path: `${user.userId}/${orderId}/knife-1/extra.jpg`,
      p_original_filename: "extra.jpg",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/MAX_PHOTOS_PER_KNIFE_EXCEEDED/i);
  });

  it("freeze: apos submit, novo upload e delete rejeitados", async () => {
    const { user, client, orderId } = await setupOrder("freeze", 1);
    await register(client, orderId, user.userId, 1, 3);
    await client.rpc("submit_source_photos", { p_order_id: orderId });

    const { error: regErr } = await client.rpc("register_source_image", {
      p_order_id: orderId,
      p_knife_index: 1,
      p_storage_path: `${user.userId}/${orderId}/knife-1/after.jpg`,
      p_original_filename: "after.jpg",
    });
    expect(regErr).toBeTruthy();
    expect(regErr!.message).toMatch(/INTAKE_CLOSED/i);

    // RLS de delete é admin-only: a PostgREST não retorna erro, apenas
    // filtra a row invisível ao owner (nenhuma foto é apagada).
    const { data: deleted, error: delErr } = await client
      .from("order_images")
      .delete({ count: "exact" })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(delErr).toBeNull();
    expect(deleted).toBeNull(); // 0 rows: nenhuma foto removida pelo owner

    // Confirmação direta: as 3 fotos continuam registradas.
    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(3);
  });

  it("knife_index invalido (0, 2 em pedido de 1 faca) bloqueado", async () => {
    const { user, client, orderId } = await setupOrder("badidx", 1);
    for (const bad of [0, 2]) {
      const { error } = await client.rpc("register_source_image", {
        p_order_id: orderId,
        p_knife_index: bad,
        p_storage_path: `${user.userId}/${orderId}/knife-${bad}/x.jpg`,
        p_original_filename: "x.jpg",
      });
      expect(error).toBeTruthy();
      expect(error!.message).toMatch(/INVALID_KNIFE_INDEX/i);
    }
  });

  it("concorrencia: 4 fotos + duas tentativas paralelas -> final exatamente 5", async () => {
    const { user, client, orderId } = await setupOrder("race", 1);
    await register(client, orderId, user.userId, 1, 4);

    const attempts = await Promise.all([
      client.rpc("register_source_image", {
        p_order_id: orderId,
        p_knife_index: 1,
        p_storage_path: `${user.userId}/${orderId}/knife-1/${crypto.randomUUID()}.jpg`,
        p_original_filename: "r1.jpg",
      }),
      client.rpc("register_source_image", {
        p_order_id: orderId,
        p_knife_index: 1,
        p_storage_path: `${user.userId}/${orderId}/knife-1/${crypto.randomUUID()}.jpg`,
        p_original_filename: "r2.jpg",
      }),
    ]);

    const succeeded = attempts.filter((a) => !a.error).length;
    const failed = attempts.filter((a) => a.error).length;
    expect(succeeded).toBe(1);
    expect(failed).toBe(1);
    expect(attempts.find((a) => a.error)!.error!.message).toMatch(
      /MAX_PHOTOS_PER_KNIFE_EXCEEDED/i,
    );

    const o = await orderRow(client, orderId);
    expect(o.source_image_count).toBe(5);
  });

  it("1 angle + 1 source photo NAO ativa mais a fila (bug corrigido)", async () => {
    const { user, client, orderId } = await setupOrder("bugfix", 1);
    await register(client, orderId, user.userId, 1, 1);
    await pay(client, orderId);
    const o = await orderRow(client, orderId);
    expect(o.source_image_count).toBe(1);
    expect(o.total_images).toBe(1);
    expect(o.production_ready_at).toBeNull();
  });

  it("submit e idempotente: segunda chamada nao altera timestamp", async () => {
    const { user, client, orderId } = await setupOrder("idemsub", 1);
    await register(client, orderId, user.userId, 1, 3);
    const { data: first } = await client.rpc("submit_source_photos", {
      p_order_id: orderId,
    });
    const { data: second } = await client.rpc("submit_source_photos", {
      p_order_id: orderId,
    });
    expect(second!.source_photos_submitted_at).toBe(first!.source_photos_submitted_at);
  });

  // ===== Autoridade: register_source_image e o unico caminho (migration 0010) =====

  it("insert direto de kind='source' pelo cliente e BLOQUEADO; RPC passa", async () => {
    const { user, client, orderId } = await setupOrder("auth", 1);

    // Caminho antigo (bypass) — deve falhar pela policy 0010.
    const { data: direct, error: directErr } = await client
      .from("order_images")
      .insert({
        order_id: orderId,
        kind: "source",
        knife_index: 1,
        storage_path: `${user.userId}/${orderId}/knife-1/bypass.jpg`,
        original_filename: "bypass.jpg",
      })
      .select("id");
    expect(directErr).toBeTruthy();
    expect(direct).toBeNull();

    // Caminho autoridade — deve passar.
    const { data: viaRpc, error: rpcErr } = await client.rpc(
      "register_source_image",
      {
        p_order_id: orderId,
        p_knife_index: 1,
        p_storage_path: `${user.userId}/${orderId}/knife-1/ok.jpg`,
        p_original_filename: "ok.jpg",
      },
    );
    expect(rpcErr).toBeNull();
    expect(viaRpc!.id).toBeTruthy();

    // Confirmacao: exatamente 1 source photo no banco.
    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(1);
  });

  it("delete antes do submit: cliente remove 1 de 3 fotos (retorna storage_path)", async () => {
    const { user, client, orderId } = await setupOrder("delopen", 1);
    const registered = await register(client, orderId, user.userId, 1, 3);
    const target = registered[0]!.data!;

    const { data: removedPath, error } = await client.rpc("delete_source_image", {
      p_image_id: target.id,
    });
    expect(error).toBeNull();
    expect(removedPath).toBe(target.storage_path);

    const o = await orderRow(client, orderId);
    expect(o.source_image_count).toBe(2);
  });

  it("delete apos submit: BLOQUEADO, 3 fotos permanecem", async () => {
    const { user, client, orderId } = await setupOrder("delclosed", 1);
    const registered = await register(client, orderId, user.userId, 1, 3);
    await client.rpc("submit_source_photos", { p_order_id: orderId });

    const { error } = await client.rpc("delete_source_image", {
      p_image_id: registered[0]!.data!.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/INTAKE_CLOSED/i);

    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(3);
  });

  it("cross-user delete: cliente B nao deleta foto do cliente A", async () => {
    const { user, client, orderId } = await setupOrder("crossdel", 1);
    const registered = await register(client, orderId, user.userId, 1, 3);

    const intruder = await createFixtureUser(service, "crossdel-b");
    createdUserIds.push(intruder.userId);
    const intruderClient = await signInUser(intruder.email, intruder.password);

    const { error } = await intruderClient.rpc("delete_source_image", {
      p_image_id: registered[0]!.data!.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/FORBIDDEN/i);
  });

  it("admin continua podendo inserir result image (nao afetado pela 0010)", async () => {
    const { client, orderId } = await setupOrder("adminres", 1);
    const { error } = await adminClient.from("order_images").insert({
      order_id: orderId,
      kind: "result",
      storage_path: `results/${orderId}/final.jpg`,
      original_filename: "final.jpg",
    });
    expect(error).toBeNull();
  });

  // ===== Autoridade: register_source_image e o unico caminho (migration 0010) =====

  it("insert direto de kind='source' pelo cliente e BLOQUEADO; RPC passa", async () => {
    const { user, client, orderId } = await setupOrder("auth", 1);

    // Caminho antigo (bypass) — deve falhar pela policy 0010.
    const { data: direct, error: directErr } = await client
      .from("order_images")
      .insert({
        order_id: orderId,
        kind: "source",
        knife_index: 1,
        storage_path: `${user.userId}/${orderId}/knife-1/bypass.jpg`,
        original_filename: "bypass.jpg",
      })
      .select("id");
    expect(directErr).toBeTruthy();
    expect(direct).toBeNull();

    // Caminho autoridade — deve passar.
    const { data: viaRpc, error: rpcErr } = await client.rpc(
      "register_source_image",
      {
        p_order_id: orderId,
        p_knife_index: 1,
        p_storage_path: `${user.userId}/${orderId}/knife-1/ok.jpg`,
        p_original_filename: "ok.jpg",
      },
    );
    expect(rpcErr).toBeNull();
    expect(viaRpc!.id).toBeTruthy();

    // Confirmacao: exatamente 1 source photo no banco.
    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(1);
  });

  it("delete antes do submit: cliente remove 1 de 3 fotos (retorna storage_path)", async () => {
    const { user, client, orderId } = await setupOrder("delopen", 1);
    const registered = await register(client, orderId, user.userId, 1, 3);
    const target = registered[0]!.data!;

    const { data: removedPath, error } = await client.rpc("delete_source_image", {
      p_image_id: target.id,
    });
    expect(error).toBeNull();
    expect(removedPath).toBe(target.storage_path);

    const o = await orderRow(client, orderId);
    expect(o.source_image_count).toBe(2);
  });

  it("delete apos submit: BLOQUEADO, 3 fotos permanecem", async () => {
    const { user, client, orderId } = await setupOrder("delclosed", 1);
    const registered = await register(client, orderId, user.userId, 1, 3);
    await client.rpc("submit_source_photos", { p_order_id: orderId });

    const { error } = await client.rpc("delete_source_image", {
      p_image_id: registered[0]!.data!.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/INTAKE_CLOSED/i);

    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(3);
  });

  it("cross-user delete: cliente B nao deleta foto do cliente A", async () => {
    const { user, client, orderId } = await setupOrder("crossdel", 1);
    const registered = await register(client, orderId, user.userId, 1, 3);

    const intruder = await createFixtureUser(service, "crossdel-b");
    createdUserIds.push(intruder.userId);
    const intruderClient = await signInUser(intruder.email, intruder.password);

    const { error } = await intruderClient.rpc("delete_source_image", {
      p_image_id: registered[0]!.data!.id,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/FORBIDDEN/i);
  });

  it("admin continua podendo inserir result image (nao afetado pela 0010)", async () => {
    const { client, orderId } = await setupOrder("adminres", 1);
    const { error } = await adminClient.from("order_images").insert({
      order_id: orderId,
      kind: "result",
      storage_path: `results/${orderId}/final.jpg`,
      original_filename: "final.jpg",
    });
    expect(error).toBeNull();
  });

  // ===== Idempotencia por storage_path (migration 0011) =====

  it("replay: mesmo storage_path registrado duas vezes -> apenas 1 row", async () => {
    const { user, client, orderId } = await setupOrder("replay", 1);
    const path = `${user.userId}/${orderId}/knife-1/${crypto.randomUUID()}.jpg`;

    const first = await client.rpc("register_source_image", {
      p_order_id: orderId,
      p_knife_index: 1,
      p_storage_path: path,
      p_original_filename: "same.jpg",
    });
    expect(first.error).toBeNull();

    const second = await client.rpc("register_source_image", {
      p_order_id: orderId,
      p_knife_index: 1,
      p_storage_path: path,
      p_original_filename: "same.jpg",
    });
    expect(second.error).toBeNull();
    expect(second.data!.id).toBe(first.data!.id);

    const o = await orderRow(client, orderId);
    expect(o.source_image_count).toBe(1);
  });

  it("replay concorrente: dois registers simultaneos com mesmo path -> 1 row", async () => {
    const { user, client, orderId } = await setupOrder("replayc", 1);
    const path = `${user.userId}/${orderId}/knife-1/${crypto.randomUUID()}.jpg`;

    const [a, b] = await Promise.all([
      client.rpc("register_source_image", {
        p_order_id: orderId,
        p_knife_index: 1,
        p_storage_path: path,
        p_original_filename: "same.jpg",
      }),
      client.rpc("register_source_image", {
        p_order_id: orderId,
        p_knife_index: 1,
        p_storage_path: path,
        p_original_filename: "same.jpg",
      }),
    ]);

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data!.id).toBe(b.data!.id);

    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(1);
  });

  // ===== Idempotencia por storage_path (migration 0011) =====

  it("snapshot: mudanca no admin nao altera pedido existente", async () => {
    const { client, orderId } = await setupOrder("snapiso", 1);
    const { error } = await adminClient.rpc("update_app_settings", {
      p_daily_capacity: 4,
      p_cutoff_time: "17:00",
      p_timezone: "America/Sao_Paulo",
      p_min_source_photos_per_knife: 4,
      p_max_source_photos_per_knife: 7,
      p_max_source_photo_size_mb: 30,
    });
    expect(error).toBeNull();

    try {
      const o = await orderRow(client, orderId);
      expect(o.required_source_photos_per_knife).toBe(3);
      expect(o.max_source_photos_per_knife).toBe(5);
      expect(o.max_source_photo_size_mb).toBe(25);
    } finally {
      await adminClient.rpc("update_app_settings", {
        p_daily_capacity: 4,
        p_cutoff_time: "17:00",
        p_timezone: "America/Sao_Paulo",
        p_min_source_photos_per_knife: 3,
        p_max_source_photos_per_knife: 5,
        p_max_source_photo_size_mb: 25,
      });
    }
  });
});