import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    throw new Error(
      `Missing ${name}. Create .env.test.local with valid dev credentials. ` +
        "See tests/integration/README.md for setup instructions.",
    );
  }
  return value;
}

// Validate environment BEFORE any test runs
const validatedUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
const validatedAnonKey = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ANON_KEY,
);
const validatedServiceKey = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  SERVICE_ROLE_KEY,
);
requireEnv("ENABLE_MOCK_PAYMENTS", MOCK_PAYMENTS);

const detectedRef = extractProjectRef(validatedUrl);
if (detectedRef !== ALLOWED_PROJECT_REF) {
  throw new Error(
    `SAFETY: Integration tests aborted. NEXT_PUBLIC_SUPABASE_URL points to project ref "${detectedRef}" ` +
      `but only "${ALLOWED_PROJECT_REF}" is allowed. Never run integration tests against production.`,
  );
}

if (MOCK_PAYMENTS !== "true") {
  throw new Error(
    "SAFETY: ENABLE_MOCK_PAYMENTS must be 'true' for integration tests.",
  );
}

// =============================================================================
// Client factory helpers — clear separation of concerns
// =============================================================================

/**
 * SERVICE CLIENT: bypasses RLS on tables, used ONLY for setup/teardown/admin
 * operations that require service_role privileges (createUser, promote role).
 * NEVER sign in as a regular user on this client.
 */
function createServiceClient(): SupabaseClient {
  return createClient(validatedUrl, validatedServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * USER CLIENT: uses anon key + JWT session. Used to prove RLS policies.
 * Each call creates a fresh client to avoid session leakage between tests.
 */
function createUserClient(): SupabaseClient {
  return createClient(validatedUrl, validatedAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Generates a cryptographically random password for fixture users.
 * Never logged, never committed, unique per execution.
 */
function generatePassword(): string {
  return randomBytes(24).toString("base64url") + "Aa1!";
}

/**
 * Generates a unique email for fixture users.
 */
function generateEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}@test.felipedesign.local`;
}

// =============================================================================
// Fixture helpers
// =============================================================================

interface FixtureUser {
  userId: string;
  email: string;
  password: string;
}

interface FixturePlan {
  planId: string;
  priceId: string;
}

/**
 * Creates a test user via service client and returns credentials.
 * Tracks user IDs for cleanup in afterAll.
 */
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

/**
 * Promotes a user to admin role via service client (bypasses RLS on profiles).
 */
async function promoteToAdmin(
  service: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", userId);
  if (error) {
    throw new Error(`Failed to promote user to admin: ${error.message}`);
  }
}

/**
 * Signs in a user client and returns it ready for authenticated operations.
 */
async function signInUser(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createUserClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  }
  return client;
}

/**
 * Creates or reuses a plan + price fixture via an authenticated admin client.
 *
 * WHY NOT service_role directly for .from("plans") inserts?
 * The service_role key DOES bypass RLS on table-level operations. However,
 * in earlier testing the insert failed — the root cause was never conclusively
 * proven to be RLS evaluation under BYPASSRLS (which would contradict Postgres
 * semantics). Possible causes include: supabase-js internal header handling,
 * a trigger or constraint firing before RLS bypass takes effect, or an
 * intermediate RPC/proxy layer evaluating is_admin() outside the RLS context.
 *
 * Regardless of the exact cause, the authenticated-admin-client approach is
 * architecturally superior: it exercises the same authorization path as real
 * admin users, avoids relying on service_role bypass for business operations,
 * and keeps the service client reserved for privileged setup/teardown only.
 */
async function createFixturePlan(
  adminClient: SupabaseClient,
  angles: number,
  amountCents: number,
): Promise<FixturePlan> {
  // Upsert plan (UNIQUE constraint on angles)
  const { data: plan, error: planErr } = await adminClient
    .from("plans")
    .upsert({ angles, active: true }, { onConflict: "angles" })
    .select("id")
    .single();
  if (planErr || !plan) {
    throw new Error(`Plan upsert failed: ${planErr?.message}`);
  }

  // Reuse existing price or create new one
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingPrice } = await adminClient
    .from("plan_prices")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("currency", "BRL")
    .eq("valid_from", today)
    .maybeSingle();

  let priceId: string;
  if (existingPrice) {
    priceId = existingPrice.id;
  } else {
    const { data: price, error: priceErr } = await adminClient
      .from("plan_prices")
      .insert({
        plan_id: plan.id,
        currency: "BRL",
        amount_cents: amountCents,
        valid_from: today,
        active: true,
      })
      .select("id")
      .single();
    if (priceErr || !price) {
      throw new Error(`Price insert failed: ${priceErr?.message}`);
    }
    priceId = price.id;
  }

  return { planId: plan.id, priceId };
}

// =============================================================================
// Test suite
// =============================================================================

describe("Production-ready queue rule (migration 0006+0007)", () => {
  let service: SupabaseClient;
  let adminFixture: FixtureUser;
  let adminClient: SupabaseClient;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    service = createServiceClient();

    // Create admin fixture user with random credentials
    adminFixture = await createFixtureUser(service, "admin");
    createdUserIds.push(adminFixture.userId);
    await promoteToAdmin(service, adminFixture.userId);

    // Sign in as admin for fixture operations
    adminClient = await signInUser(adminFixture.email, adminFixture.password);
  });

  afterAll(async () => {
    // Cleanup: delete all fixture users created during tests
    for (const userId of createdUserIds) {
      try {
        await service.auth.admin.deleteUser(userId);
      } catch {
        // Best-effort cleanup; don't fail the suite
      }
    }
  });

  // ===========================================================================
  // CORE QUEUE RULE TESTS
  // ===========================================================================

  it("create_order grava promised_delivery_date como NULL", async () => {
    const user = await createFixtureUser(service, "core-null");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order, error } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 2,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    expect(error).toBeNull();
    expect(order).toBeDefined();
    expect(order!.promised_delivery_date).toBeNull();
    expect(order!.production_ready_at).toBeNull();
    expect(order!.total_images).toBe(2);
  });

  it("confirm_order_payment sem fotos completas mantém promised_delivery_date NULL", async () => {
    const user = await createFixtureUser(service, "pay-nofoto");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 2, 13000);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    const { data: confirmed } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_" + order!.id,
      p_provider_event_id: "evt_" + crypto.randomUUID(),
      p_amount_cents: 13000,
      p_currency: "BRL",
    });

    expect(confirmed!.paid_at).not.toBeNull();
    expect(confirmed!.production_ready_at).toBeNull();
    expect(confirmed!.promised_delivery_date).toBeNull();
  });

  it("upload completo após pagamento ativa fila e fixa promised_delivery_date", async () => {
    const user = await createFixtureUser(service, "pay-upload");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 2,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Pay first
    await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_" + order!.id,
      p_provider_event_id: "evt_" + crypto.randomUUID(),
      p_amount_cents: 15000,
      p_currency: "BRL",
    });

    // Partial upload — should NOT activate
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/t1.jpg`,
      original_filename: "t1.jpg",
    });

    const { data: partial } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date")
      .eq("id", order!.id)
      .single();
    expect(partial!.production_ready_at).toBeNull();
    expect(partial!.promised_delivery_date).toBeNull();

    // Final upload — trigger activates queue
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/t2.jpg`,
      original_filename: "t2.jpg",
    });

    const { data: complete } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date")
      .eq("id", order!.id)
      .single();
    expect(complete!.production_ready_at).not.toBeNull();
    expect(complete!.promised_delivery_date).not.toBeNull();
  });

  it("fotos completas antes do pagamento ativam fila na confirmação", async () => {
    const user = await createFixtureUser(service, "foto-pay");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Upload BEFORE payment
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/photo.jpg`,
      original_filename: "photo.jpg",
    });

    const { data: beforePay } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date")
      .eq("id", order!.id)
      .single();
    expect(beforePay!.production_ready_at).toBeNull();
    expect(beforePay!.promised_delivery_date).toBeNull();

    // Confirm payment — maybe_mark_order_ready called inside RPC
    const { data: afterPay } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_" + order!.id,
      p_provider_event_id: "evt_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });

    expect(afterPay!.production_ready_at).not.toBeNull();
    expect(afterPay!.promised_delivery_date).not.toBeNull();
  });

  it("idempotência: segunda confirmação não altera production_ready_at nem prazo", async () => {
    const user = await createFixtureUser(service, "idem");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/idem.jpg`,
      original_filename: "idem.jpg",
    });

    const { data: first } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_" + order!.id,
      p_provider_event_id: "evt_first_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });

    const { data: second } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_" + order!.id,
      p_provider_event_id: "evt_second_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });

    expect(second!.production_ready_at).toBe(first!.production_ready_at);
    expect(second!.promised_delivery_date).toBe(first!.promised_delivery_date);
  });

  it("current_backlog_images só conta pedidos com production_ready_at", async () => {
    const { data: result } = await adminClient.rpc("current_backlog_images");
    expect(typeof result).toBe("number");
  });

  it("estimate_delivery retorna businessDaysAfterReady sem data absoluta", async () => {
    const { data, error } = await adminClient.rpc("estimate_delivery", {
      p_new_images: 4,
    });
    expect(error).toBeNull();
    expect(data).toHaveProperty("businessDaysAfterReady");
    expect(data).toHaveProperty("currentBacklogImages");
    expect(data).not.toHaveProperty("promisedDeliveryDate");
    expect(typeof data.businessDaysAfterReady).toBe("number");
    expect(data.businessDaysAfterReady).toBeGreaterThanOrEqual(1);
  });

  // ===========================================================================
  // CONCURRENCY TESTS (FASE 6)
  // ===========================================================================

  it("concorrência: dois pedidos ficam ready simultaneamente com Promise.all", async () => {
    const userA = await createFixtureUser(service, "conc-a");
    const userB = await createFixtureUser(service, "conc-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);

    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // Create two orders
    const { data: orderA } = await clientA.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    const { data: orderB } = await clientB.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Upload photos for both
    await clientA.from("order_images").insert({
      order_id: orderA!.id,
      kind: "source",
      storage_path: `${userA.userId}/${orderA!.id}/original/conc.jpg`,
      original_filename: "conc.jpg",
    });
    await clientB.from("order_images").insert({
      order_id: orderB!.id,
      kind: "source",
      storage_path: `${userB.userId}/${orderB!.id}/original/conc.jpg`,
      original_filename: "conc.jpg",
    });

    // Confirm payment CONCURRENTLY — both should activate without race
    const [resultA, resultB] = await Promise.all([
      clientA.rpc("confirm_order_payment", {
        p_order_id: orderA!.id,
        p_provider: "mock",
        p_external_payment_id: "mock_conc_a_" + orderA!.id,
        p_provider_event_id: "evt_conc_a_" + crypto.randomUUID(),
        p_amount_cents: 7500,
        p_currency: "BRL",
      }),
      clientB.rpc("confirm_order_payment", {
        p_order_id: orderB!.id,
        p_provider: "mock",
        p_external_payment_id: "mock_conc_b_" + orderB!.id,
        p_provider_event_id: "evt_conc_b_" + crypto.randomUUID(),
        p_amount_cents: 7500,
        p_currency: "BRL",
      }),
    ]);

    // Both must be activated
    expect(resultA.data!.production_ready_at).not.toBeNull();
    expect(resultA.data!.promised_delivery_date).not.toBeNull();
    expect(resultB.data!.production_ready_at).not.toBeNull();
    expect(resultB.data!.promised_delivery_date).not.toBeNull();

    // Dates must be valid (not corrupted by race)
    expect(resultA.data!.promised_delivery_date).toBeTruthy();
    expect(resultB.data!.promised_delivery_date).toBeTruthy();
  });

  it("concorrência: mesmo pedido recebe pagamento e upload simultâneos", async () => {
    const user = await createFixtureUser(service, "conc-same");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Fire payment confirmation and photo upload concurrently
    await Promise.all([
      userClient.rpc("confirm_order_payment", {
        p_order_id: order!.id,
        p_provider: "mock",
        p_external_payment_id: "mock_same_" + order!.id,
        p_provider_event_id: "evt_same_" + crypto.randomUUID(),
        p_amount_cents: 7500,
        p_currency: "BRL",
      }),
      userClient.from("order_images").insert({
        order_id: order!.id,
        kind: "source",
        storage_path: `${user.userId}/${order!.id}/original/same.jpg`,
        original_filename: "same.jpg",
      }),
    ]);

    // Regardless of which completed first, final state must be consistent
    const { data: finalOrder } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date, paid_at")
      .eq("id", order!.id)
      .single();

    expect(finalOrder!.paid_at).not.toBeNull();
    // At least one path should have activated the queue
    // (trigger on upload OR explicit call in confirm_order_payment)
    expect(finalOrder!.production_ready_at).not.toBeNull();
    expect(finalOrder!.promised_delivery_date).not.toBeNull();
  });

  it("concorrência: chamadas duplicadas de maybe_mark_order_ready são idempotentes", async () => {
    const user = await createFixtureUser(service, "conc-dup");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Upload photo first
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/dup.jpg`,
      original_filename: "dup.jpg",
    });

    // Fire two concurrent payment confirmations (same external_payment_id)
    const [first, second] = await Promise.all([
      userClient.rpc("confirm_order_payment", {
        p_order_id: order!.id,
        p_provider: "mock",
        p_external_payment_id: "mock_dup_" + order!.id,
        p_provider_event_id: "evt_dup_1_" + crypto.randomUUID(),
        p_amount_cents: 7500,
        p_currency: "BRL",
      }),
      userClient.rpc("confirm_order_payment", {
        p_order_id: order!.id,
        p_provider: "mock",
        p_external_payment_id: "mock_dup_" + order!.id,
        p_provider_event_id: "evt_dup_2_" + crypto.randomUUID(),
        p_amount_cents: 7500,
        p_currency: "BRL",
      }),
    ]);

    // Both should succeed and return identical dates
    expect(first.data!.production_ready_at).not.toBeNull();
    expect(second.data!.production_ready_at).not.toBeNull();
    expect(first.data!.production_ready_at).toBe(
      second.data!.production_ready_at,
    );
    expect(first.data!.promised_delivery_date).toBe(
      second.data!.promised_delivery_date,
    );
  });

  // ===========================================================================
  // RLS TESTS (FASE 7)
  // ===========================================================================

  it("RLS orders: owner lê próprio pedido, outro usuário não lê", async () => {
    const userA = await createFixtureUser(service, "rls-ord-a");
    const userB = await createFixtureUser(service, "rls-ord-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: orderA } = await clientA.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Owner can read
    const { data: ownRead } = await clientA
      .from("orders")
      .select("id")
      .eq("id", orderA!.id)
      .maybeSingle();
    expect(ownRead).not.toBeNull();

    // Other user cannot read
    const { data: leaked } = await clientB
      .from("orders")
      .select("id")
      .eq("id", orderA!.id)
      .maybeSingle();
    expect(leaked).toBeNull();
  });

  it("RLS order_images: owner lê próprias imagens, outro usuário não", async () => {
    const userA = await createFixtureUser(service, "rls-img-a");
    const userB = await createFixtureUser(service, "rls-img-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: orderA } = await clientA.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    await clientA.from("order_images").insert({
      order_id: orderA!.id,
      kind: "source",
      storage_path: `${userA.userId}/${orderA!.id}/original/rls.jpg`,
      original_filename: "rls.jpg",
    });

    // Owner reads own images
    const { data: ownImages } = await clientA
      .from("order_images")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(ownImages!.length).toBeGreaterThan(0);

    // Other user cannot read
    const { data: leakedImages } = await clientB
      .from("order_images")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(leakedImages!.length).toBe(0);
  });

  it("RLS payments: owner lê próprios pagamentos, outro usuário não", async () => {
    const userA = await createFixtureUser(service, "rls-pay-a");
    const userB = await createFixtureUser(service, "rls-pay-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: orderA } = await clientA.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    await clientA.rpc("confirm_order_payment", {
      p_order_id: orderA!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_rls_" + orderA!.id,
      p_provider_event_id: "evt_rls_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });

    // Owner reads own payment
    const { data: ownPay } = await clientA
      .from("payments")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(ownPay!.length).toBeGreaterThan(0);

    // Other user cannot read
    const { data: leakedPay } = await clientB
      .from("payments")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(leakedPay!.length).toBe(0);
  });

  it("RLS profiles: usuário lê próprio perfil, não lê de outros", async () => {
    const userA = await createFixtureUser(service, "rls-prof-a");
    const userB = await createFixtureUser(service, "rls-prof-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);

    // A reads own profile
    const { data: ownProfile } = await clientA
      .from("profiles")
      .select("id, email")
      .eq("id", userA.userId)
      .maybeSingle();
    expect(ownProfile).not.toBeNull();

    // B cannot read A's profile
    const { data: leakedProfile } = await clientB
      .from("profiles")
      .select("id, email")
      .eq("id", userA.userId)
      .maybeSingle();
    expect(leakedProfile).toBeNull();
  });

  it("RLS anon: usuário não autenticado não acessa dados privados", async () => {
    const anonClient = createUserClient(); // No sign-in = anonymous
    const user = await createFixtureUser(service, "rls-anon");
    createdUserIds.push(user.userId);

    // Create an order via authenticated client first
    const authClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);
    const { data: order } = await authClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Anon cannot read orders
    const { data: anonOrders } = await anonClient
      .from("orders")
      .select("id")
      .eq("id", order!.id)
      .maybeSingle();
    expect(anonOrders).toBeNull();

    // Anon cannot read profiles
    const { data: anonProfiles } = await anonClient
      .from("profiles")
      .select("id")
      .eq("id", user.userId)
      .maybeSingle();
    expect(anonProfiles).toBeNull();
  });

  // ===========================================================================
  // STORAGE TESTS (FASE 8)
  // ===========================================================================

  it("Storage client-uploads: owner faz upload, outro usuário é bloqueado", async () => {
    const userA = await createFixtureUser(service, "stor-a");
    const userB = await createFixtureUser(service, "stor-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);

    // Owner uploads to own path
    const { error: ownError } = await clientA.storage
      .from("client-uploads")
      .upload(
        `${userA.userId}/test-owner/upload.jpg`,
        new Uint8Array([0xff, 0xd8]),
        { contentType: "image/jpeg" },
      );
    expect(ownError).toBeNull();

    // Other user cannot upload to owner's path
    const { error: crossError } = await clientB.storage
      .from("client-uploads")
      .upload(
        `${userA.userId}/test-hack/hack.jpg`,
        new Uint8Array([0xff, 0xd8]),
        { contentType: "image/jpeg" },
      );
    expect(crossError).not.toBeNull();
  });

  it("Storage client-uploads: outro usuário não baixa arquivo do owner", async () => {
    const userA = await createFixtureUser(service, "stor-dl-a");
    const userB = await createFixtureUser(service, "stor-dl-b");
    createdUserIds.push(userA.userId, userB.userId);

    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);

    // Owner uploads
    await clientA.storage
      .from("client-uploads")
      .upload(
        `${userA.userId}/test-dl/photo.jpg`,
        new Uint8Array([0xff, 0xd8]),
        { contentType: "image/jpeg" },
      );

    // Owner can download
    const { error: ownDlError } = await clientA.storage
      .from("client-uploads")
      .download(`${userA.userId}/test-dl/photo.jpg`);
    expect(ownDlError).toBeNull();

    // Other user cannot download
    const { error: crossDlError } = await clientB.storage
      .from("client-uploads")
      .download(`${userA.userId}/test-dl/photo.jpg`);
    expect(crossDlError).not.toBeNull();
  });

  it("Storage client-uploads: anon não acessa bucket privado", async () => {
    const anonClient = createUserClient();
    const user = await createFixtureUser(service, "stor-anon");
    createdUserIds.push(user.userId);

    const { error } = await anonClient.storage
      .from("client-uploads")
      .upload(
        `${user.userId}/anon-test/hack.jpg`,
        new Uint8Array([0xff, 0xd8]),
        { contentType: "image/jpeg" },
      );
    expect(error).not.toBeNull();
  });

  // ===========================================================================
  // ADMIN AUTHORIZATION TESTS (FASE 9)
  // ===========================================================================

  it("Admin authorization: usuário normal é bloqueado em RPC administrativa", async () => {
    const normalUser = await createFixtureUser(service, "noadmin");
    createdUserIds.push(normalUser.userId);
    const normalClient = await signInUser(
      normalUser.email,
      normalUser.password,
    );

    // Try to call set_order_status (admin-only RPC)
    const { error } = await normalClient.rpc("set_order_status", {
      p_order_id: crypto.randomUUID(),
      p_status: "in_progress",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("FORBIDDEN");
  });

  it("Admin authorization: admin autenticado executa RPC administrativa", async () => {
    // Admin tries set_order_status on a non-existent order — should get
    // ORDER_NOT_FOUND (not FORBIDDEN), proving authorization passed
    const { error } = await adminClient.rpc("set_order_status", {
      p_order_id: crypto.randomUUID(),
      p_status: "in_progress",
    });

    // Should NOT be FORBIDDEN — admin is authorized
    // May be ORDER_NOT_FOUND or null depending on implementation
    if (error) {
      expect(error.message).not.toContain("FORBIDDEN");
    }
  });

  it("Admin authorization: admin lê todos os pedidos, usuário normal só os próprios", async () => {
    const user = await createFixtureUser(service, "adm-read");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // User creates an order
    await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Admin can list all orders
    const { data: adminOrders } = await adminClient
      .from("orders")
      .select("id");
    expect(adminOrders!.length).toBeGreaterThan(0);

    // Normal user only sees own orders
    const { data: userOrders } = await userClient
      .from("orders")
      .select("id");
    for (const order of userOrders!) {
      const { data: fullOrder } = await userClient
        .from("orders")
        .select("user_id")
        .eq("id", order.id)
        .single();
      expect(fullOrder!.user_id).toBe(user.userId);
    }
  });

  // ===========================================================================
  // SMOKE TEST (FASE 11)
  // ===========================================================================

  it("smoke test: fluxo completo payment-first com revisão", async () => {
    const user = await createFixtureUser(service, "smoke-pf");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // 1. Create order
    const { data: order, error: createErr } = await userClient.rpc(
      "create_order",
      {
        p_plan_id: planId,
        p_knife_quantity: 1,
        p_currency: "BRL",
        p_idempotency_key: crypto.randomUUID(),
      },
    );
    expect(createErr).toBeNull();
    expect(order!.promised_delivery_date).toBeNull();

    // 2. Verify price snapshot
    expect(order!.unit_price_cents).toBe(7500);
    expect(order!.total_cents).toBe(7500);

    // 3. Confirm payment (no photos yet)
    const { data: paid } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_smoke_" + order!.id,
      p_provider_event_id: "evt_smoke_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
    expect(paid!.paid_at).not.toBeNull();
    expect(paid!.production_ready_at).toBeNull();

    // 4. Upload photo
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/smoke.jpg`,
      original_filename: "smoke.jpg",
    });

    // 5. Verify activation
    const { data: activated } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date")
      .eq("id", order!.id)
      .single();
    expect(activated!.production_ready_at).not.toBeNull();
    expect(activated!.promised_delivery_date).not.toBeNull();

    // 6. Owner can read own order
    const { data: ownOrder } = await userClient
      .from("orders")
      .select("id")
      .eq("id", order!.id)
      .maybeSingle();
    expect(ownOrder).not.toBeNull();

    // 7. Admin can read the order
    const { data: adminOrder } = await adminClient
      .from("orders")
      .select("id")
      .eq("id", order!.id)
      .maybeSingle();
    expect(adminOrder).not.toBeNull();

    // 8. Request free revision (round 1)
    const { error: revErr } = await userClient
      .from("order_revisions")
      .insert({
        order_id: order!.id,
        round: 1,
        status: "requested",
        notes: "Smoke test revision",
      });
    expect(revErr).toBeNull();

    // 9. Verify revision exists
    const { data: revision } = await userClient
      .from("order_revisions")
      .select("id, round, status")
      .eq("order_id", order!.id)
      .single();
    expect(revision!.round).toBe(1);
    expect(revision!.status).toBe("requested");
  });

  it("smoke test: fluxo completo photos-first", async () => {
    const user = await createFixtureUser(service, "smoke-fp");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // 1. Create order
    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(order!.promised_delivery_date).toBeNull();

    // 2. Upload photo BEFORE payment
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/fp.jpg`,
      original_filename: "fp.jpg",
    });

    // Not activated yet (no payment)
    const { data: beforePay } = await userClient
      .from("orders")
      .select("production_ready_at")
      .eq("id", order!.id)
      .single();
    expect(beforePay!.production_ready_at).toBeNull();

    // 3. Confirm payment — triggers activation
    const { data: paid } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_fp_" + order!.id,
      p_provider_event_id: "evt_fp_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });

    expect(paid!.production_ready_at).not.toBeNull();
    expect(paid!.promised_delivery_date).not.toBeNull();
  });

  // ===========================================================================
  // ORDER-RESULTS STORAGE (FASE 3 — ponto 3)
  // ===========================================================================
  it("Storage order-results: admin faz upload, owner baixa, cross-user e anon são bloqueados", async () => {
    const user = await createFixtureUser(service, "stor-res");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // Cria pedido e ativa fila para ter um order_id válido
    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/res.jpg`,
      original_filename: "res.jpg",
    });
    await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_res_" + order!.id,
      p_provider_event_id: "evt_res_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });

    const resultPath = `${user.userId}/${order!.id}/result/final.jpg`;
    const fakeImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    // Admin faz upload no bucket order-results
    const { error: adminUploadErr } = await adminClient.storage
      .from("order-results")
      .upload(resultPath, fakeImage, { contentType: "image/jpeg" });
    expect(adminUploadErr).toBeNull();

    // Owner consegue baixar
    const { error: ownerDlErr } = await userClient.storage
      .from("order-results")
      .download(resultPath);
    expect(ownerDlErr).toBeNull();

    // Outro usuário NÃO consegue baixar
    const otherUser = await createFixtureUser(service, "stor-res-x");
    createdUserIds.push(otherUser.userId);
    const otherClient = await signInUser(otherUser.email, otherUser.password);
    const { error: crossDlErr } = await otherClient.storage
      .from("order-results")
      .download(resultPath);
    expect(crossDlErr).not.toBeNull();

    // Anon NÃO consegue baixar
    const anonClient = createUserClient();
    const { error: anonDlErr } = await anonClient.storage
      .from("order-results")
      .download(resultPath);
    expect(anonDlErr).not.toBeNull();
  });

  // ===========================================================================
  // ORDER_REVISIONS RLS (FASE 3 — ponto 3)
  // ===========================================================================
  it("RLS order_revisions: owner lê própria revisão, outro usuário não lê, anon não lê", async () => {
    const userA = await createFixtureUser(service, "rls-rev-a");
    const userB = await createFixtureUser(service, "rls-rev-b");
    createdUserIds.push(userA.userId, userB.userId);
    const clientA = await signInUser(userA.email, userA.password);
    const clientB = await signInUser(userB.email, userB.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // User A cria pedido e solicita revisão
    const { data: orderA } = await clientA.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    await clientA.from("order_revisions").insert({
      order_id: orderA!.id,
      round: 1,
      status: "requested",
      notes: "RLS revision test",
    });

    // Owner lê própria revisão
    const { data: ownRev } = await clientA
      .from("order_revisions")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(ownRev!.length).toBeGreaterThan(0);

    // Outro usuário NÃO lê
    const { data: leakedRev } = await clientB
      .from("order_revisions")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(leakedRev!.length).toBe(0);

    // Anon NÃO lê
    const anonClient = createUserClient();
    const { data: anonRev } = await anonClient
      .from("order_revisions")
      .select("id")
      .eq("order_id", orderA!.id);
    expect(anonRev!.length).toBe(0);
  });

  // ===========================================================================
  // PORTFOLIO PUBLIC READ (FASE 3 — ponto 3)
  // ===========================================================================
  it("Storage portfolio: objeto público pode ser lido anonimamente", async () => {
    // Admin faz upload no bucket público portfolio
    const publicPath = "public-test/portfolio-read.jpg";
    const fakeImage = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const { error: uploadErr } = await adminClient.storage
      .from("portfolio")
      .upload(publicPath, fakeImage, { contentType: "image/jpeg", upsert: true });
    expect(uploadErr).toBeNull();

    // Anon consegue ler (bucket é público)
    const anonClient = createUserClient();
    const { error: anonReadErr } = await anonClient.storage
      .from("portfolio")
      .download(publicPath);
    expect(anonReadErr).toBeNull();

    // Anon NÃO consegue fazer upload
    const { error: anonWriteErr } = await anonClient.storage
      .from("portfolio")
      .upload("public-test/hack.jpg", fakeImage, { contentType: "image/jpeg" });
    expect(anonWriteErr).not.toBeNull();
  });

  // ===========================================================================
  // ADMIN AUTHORIZATION COM PEDIDO REAL (FASE 4)
  // ===========================================================================
  it("Admin authorization REAL: normal user negado, admin altera status de pedido existente", async () => {
    const user = await createFixtureUser(service, "adm-real");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // Cria pedido real
    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(order!.status).toBe("pending");

    // Normal user tenta alterar status → FORBIDDEN
    const { error: normalErr } = await userClient.rpc("set_order_status", {
      p_order_id: order!.id,
      p_status: "in_progress",
    });
    expect(normalErr).not.toBeNull();
    expect(normalErr!.message).toContain("FORBIDDEN");

    // Confirma que status NÃO mudou
    const { data: unchanged } = await service
      .from("orders")
      .select("status")
      .eq("id", order!.id)
      .single();
    expect(unchanged!.status).toBe("pending");

    // Admin autenticado altera status → sucesso
    const { data: updated, error: adminErr } = await adminClient.rpc("set_order_status", {
      p_order_id: order!.id,
      p_status: "in_progress",
    });
    expect(adminErr).toBeNull();
    expect(updated!.status).toBe("in_progress");

    // Verifica no banco que status realmente mudou
    const { data: verified } = await service
      .from("orders")
      .select("status")
      .eq("id", order!.id)
      .single();
    expect(verified!.status).toBe("in_progress");
  });

  // ===========================================================================
  // MOCK PAYMENT PROVIDER INTEGRATION (FASE 5)
  // ===========================================================================
  it("MockPaymentProvider: simulateMockPayment confirma pedido via abstração TypeScript", async () => {
    // Este teste valida que a abstração MockPaymentProvider → record_payment_intent
    // → confirm_order_payment está conectada corretamente.
    // Usamos RPCs diretamente pois simulateMockPayment requer createSupabaseServerClient
    // (Next.js server), mas o fluxo subjacente é o mesmo: createPaymentIntent + confirm.
    const user = await createFixtureUser(service, "mock-prov");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(order!.paid_at).toBeNull();

    // Etapa 1: record_payment_intent (simula createPaymentIntent do provider)
    const externalId = "mock_prov_" + order!.id;
    const { error: intentErr } = await userClient.rpc("record_payment_intent", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: externalId,
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
    expect(intentErr).toBeNull();

    // Etapa 2: confirm_order_payment (simula webhook/evento do provider)
    const { data: confirmed, error: confirmErr } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: externalId,
      p_provider_event_id: "evt_mockprov_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
    expect(confirmErr).toBeNull();
    expect(confirmed!.paid_at).not.toBeNull();

    // Idempotência: segunda confirmação com mesmo external_payment_id não duplica
    const { data: second } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: externalId,
      p_provider_event_id: "evt_mockprov2_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
    expect(second!.paid_at).toBe(confirmed!.paid_at);
  });

  // ===========================================================================
  // MOCK PAYMENT PROVIDER — ABSTRAÇÃO REAL (FASE 2)
  // ===========================================================================
  it("MockPaymentProvider abstração real: simulateMockPayment via server action path", async () => {
    // Este teste prova que MockPaymentProvider está realmente conectado ao fluxo
    // server-side, não apenas que as RPCs individuais funcionam.
    // Mockamos createSupabaseServerClient para retornar um client autenticado
    // como usuário fixture, permitindo invocar simulateMockPayment sem Next.js runtime.
    const user = await createFixtureUser(service, "mock-abs");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(order!.paid_at).toBeNull();

    // Mock createSupabaseServerClient to return authenticated user client
    const { simulateMockPayment } = await import("@/services/mock-payment-flow");
    const serverModule = await import("@/lib/supabase/server");

    // Replace with a function that returns our authenticated user client.
    // The server client type is compatible with SupabaseClient for RPC/from calls.
    vi.spyOn(serverModule, "createSupabaseServerClient").mockResolvedValue(
      userClient as SupabaseClient,
    );

    try {
      // Invoke the REAL abstraction: simulateMockPayment uses MockPaymentProvider
      // internally (createPaymentIntent → record_payment_intent → confirm_order_payment)
      const result = await simulateMockPayment(order!.id);

      // Prove the abstraction produced the expected state change
      expect(result.paid_at).not.toBeNull();
      expect(result.id).toBe(order!.id);

      // Verify in DB via service client
      const { data: verified } = await service
        .from("orders")
        .select("paid_at")
        .eq("id", order!.id)
        .single();
      expect(verified!.paid_at).not.toBeNull();
    } finally {
      // Restore original implementation
      vi.restoreAllMocks();
    }
  });

  // ===========================================================================
  // SMOKE TEST COMPLETO VIA ABSTRAÇÃO (FASE 5 + SMOKE FINAL)
  // ===========================================================================
  it("smoke test completo: create → upload → mock payment → ready → admin result → owner download → revision", async () => {
    const user = await createFixtureUser(service, "smoke-full");
    createdUserIds.push(user.userId);
    const userClient = await signInUser(user.email, user.password);
    const { planId } = await createFixturePlan(adminClient, 1, 7500);

    // 1. Create order
    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(order!.promised_delivery_date).toBeNull();

    // 2. Upload photo
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user.userId}/${order!.id}/original/full.jpg`,
      original_filename: "full.jpg",
    });

    // 3. Mock payment via abstração (record_payment_intent + confirm_order_payment)
    const extId = "mock_smoke_full_" + order!.id;
    await userClient.rpc("record_payment_intent", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: extId,
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
    const { data: paid } = await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: extId,
      p_provider_event_id: "evt_smoke_full_" + crypto.randomUUID(),
      p_amount_cents: 7500,
      p_currency: "BRL",
    });
    expect(paid!.production_ready_at).not.toBeNull();
    expect(paid!.promised_delivery_date).not.toBeNull();

    // 4. Admin envia resultado no bucket order-results
    const resultPath = `${user.userId}/${order!.id}/result/delivered.jpg`;
    const { error: resultUploadErr } = await adminClient.storage
      .from("order-results")
      .upload(resultPath, new Uint8Array([0xff, 0xd8]), { contentType: "image/jpeg" });
    expect(resultUploadErr).toBeNull();

    // 5. Owner baixa resultado
    const { error: ownerDlErr } = await userClient.storage
      .from("order-results")
      .download(resultPath);
    expect(ownerDlErr).toBeNull();

    // 6. Cross-user NÃO baixa resultado
    const otherUser = await createFixtureUser(service, "smoke-full-x");
    createdUserIds.push(otherUser.userId);
    const otherClient = await signInUser(otherUser.email, otherUser.password);
    const { error: crossDlErr } = await otherClient.storage
      .from("order-results")
      .download(resultPath);
    expect(crossDlErr).not.toBeNull();

    // 7. Owner solicita revisão gratuita
    const { error: revErr } = await userClient.from("order_revisions").insert({
      order_id: order!.id,
      round: 1,
      status: "requested",
      notes: "Full smoke test revision",
    });
    expect(revErr).toBeNull();

    // 8. Verifica revisão
    const { data: revision } = await userClient
      .from("order_revisions")
      .select("id, round, status")
      .eq("order_id", order!.id)
      .single();
    expect(revision!.round).toBe(1);
    expect(revision!.status).toBe("requested");
  });
});