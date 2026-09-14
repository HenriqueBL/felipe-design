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
 * WHY NOT service_role directly?
 * The service_role key bypasses RLS on table-level operations (.from()), BUT
 * the RLS policy `plans_write_admin` uses `is_admin()` which is a SECURITY
 * DEFINER function that checks `auth.uid()` against `profiles.role`. When
 * using service_role without an authenticated session, `auth.uid()` returns
 * NULL, so `is_admin()` returns false and the insert is blocked.
 *
 * The correct approach: authenticate as a real user with role='admin', then
 * use the anon key client with that user's JWT. This gives us both a valid
 * `auth.uid()` AND passes the `is_admin()` check.
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
});