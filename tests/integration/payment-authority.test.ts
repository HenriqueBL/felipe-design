import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

// =============================================================================
// SAFETY GUARD (mesmo padrao dos demais suites de integracao)
// =============================================================================
const ALLOWED_PROJECT_REF = "jfsymthtepikfpexzxvk";

function extractProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. See tests/integration/README.md.`);
  }
  return value;
}

const validatedUrl = requireEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const validatedAnonKey = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
const validatedServiceKey = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
requireEnv("ENABLE_MOCK_PAYMENTS", process.env.ENABLE_MOCK_PAYMENTS);

const detectedRef = extractProjectRef(validatedUrl);
if (detectedRef !== ALLOWED_PROJECT_REF) {
  throw new Error(
    `SAFETY: Integration tests aborted. Project ref "${detectedRef}" != "${ALLOWED_PROJECT_REF}".`,
  );
}

// =============================================================================
// Clients / fixtures
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

// Fixtures de plano usam client admin autenticado (mesmo padrao dos demais
// suites: inserts direto via service_role em plans/plan_prices falharam).
async function createFixturePlan(
  adminClient: SupabaseClient,
  angles: number,
  amountCents: number,
): Promise<string> {
  const { data: plan, error: planErr } = await adminClient
    .from("plans")
    .upsert({ angles, active: true }, { onConflict: "angles" })
    .select("id")
    .single();
  if (planErr || !plan) {
    throw new Error(`Plan upsert failed: ${planErr?.message}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: existingPrice } = await adminClient
    .from("plan_prices")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("currency", "BRL")
    .eq("valid_from", today)
    .maybeSingle();

  if (existingPrice) return plan.id;

  const { error: priceErr } = await adminClient.from("plan_prices").insert({
    plan_id: plan.id,
    currency: "BRL",
    amount_cents: amountCents,
    valid_from: today,
    active: true,
  });
  if (priceErr) throw new Error(`Price insert failed: ${priceErr.message}`);
  return plan.id;
}

// =============================================================================
// Suite
// =============================================================================

describe("Payment Authority (migration 0012)", () => {
  let service: SupabaseClient;
  let adminClient: SupabaseClient;
  const createdUserIds: string[] = [];

  const identityCache = new Map<
    string,
    { user: FixtureUser; client: SupabaseClient }
  >();
  async function getIdentity(prefix: string) {
    let cached = identityCache.get(prefix);
    if (!cached) {
      const user = await createFixtureUser(service, prefix);
      createdUserIds.push(user.userId);
      cached = { user, client: await signInUser(user.email, user.password) };
      identityCache.set(prefix, cached);
    }
    return cached;
  }

  async function createOrder(
    client: SupabaseClient,
    planId: string,
  ): Promise<{ id: string; totalCents: number; currency: string }> {
    const { data: order, error } = await client.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error || !order) {
      throw new Error(`create_order failed: ${error?.message}`);
    }
    return {
      id: order.id,
      totalCents: order.total_cents,
      currency: order.currency,
    };
  }

  function confirmArgs(
    orderId: string,
    externalPaymentId: string,
    eventId: string,
    amountCents: number,
    currency: string,
  ) {
    return {
      p_order_id: orderId,
      p_provider: "mock" as const,
      p_external_payment_id: externalPaymentId,
      p_provider_event_id: eventId,
      p_amount_cents: amountCents,
      p_currency: currency,
    };
  }

  async function orderRow(orderId: string) {
    const { data, error } = await service
      .from("orders")
      .select("paid_at, production_ready_at, promised_delivery_date")
      .eq("id", orderId)
      .single();
    if (error || !data) throw new Error(`order select failed: ${error.message}`);
    return data;
  }

  async function paidPaymentCount(orderId: string): Promise<number> {
    const { count, error } = await service
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("status", "paid");
    if (error) throw new Error(`payments count failed: ${error.message}`);
    return count ?? 0;
  }

  beforeAll(async () => {
    service = createServiceClient();
    const adminFixture = await createFixtureUser(service, "pa-admin");
    createdUserIds.push(adminFixture.userId);
    const { error } = await service
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", adminFixture.userId);
    if (error) throw new Error(`promote failed: ${error.message}`);
    adminClient = await signInUser(adminFixture.email, adminFixture.password);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      try {
        await service.auth.admin.deleteUser(userId);
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("1. authenticated chamando confirm_order_payment diretamente recebe permission denied", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);

    const { error } = await userClient.rpc(
      "confirm_order_payment",
      confirmArgs(order.id, "mock_x_" + order.id, "evt_" + crypto.randomUUID(), order.totalCents, "BRL"),
    );
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/permission denied/i);

    const o = await orderRow(order.id);
    expect(o.paid_at).toBeNull();
  });

  it("2. authenticated chamando record_payment_intent diretamente recebe permission denied", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);

    const { error } = await userClient.rpc("record_payment_intent", {
      p_order_id: order.id,
      p_provider: "mock",
      p_external_payment_id: "mock_x_" + order.id,
      p_amount_cents: order.totalCents,
      p_currency: "BRL",
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/permission denied/i);
  });

  it("3. service role com amount errado recebe AMOUNT_MISMATCH e paid_at permanece NULL", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);

    const { error } = await service.rpc(
      "confirm_order_payment",
      confirmArgs(order.id, "mock_amt_" + order.id, "evt_" + crypto.randomUUID(), order.totalCents + 1, "BRL"),
    );
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/AMOUNT_MISMATCH/);

    const o = await orderRow(order.id);
    expect(o.paid_at).toBeNull();
  });

  it("4. service role com currency errada recebe CURRENCY_MISMATCH e paid_at permanece NULL", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);

    const { error } = await service.rpc(
      "confirm_order_payment",
      confirmArgs(order.id, "mock_cur_" + order.id, "evt_" + crypto.randomUUID(), order.totalCents, "USD"),
    );
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/CURRENCY_MISMATCH/);

    const o = await orderRow(order.id);
    expect(o.paid_at).toBeNull();
  });

  it("5. confirmacao valida grava payment paid e paid_at", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);

    const { data, error } = await service.rpc(
      "confirm_order_payment",
      confirmArgs(order.id, "mock_ok_" + order.id, "evt_ok_" + crypto.randomUUID(), order.totalCents, "BRL"),
    );
    expect(error).toBeNull();
    expect(data!.paid_at).not.toBeNull();
    expect(await paidPaymentCount(order.id)).toBe(1);
  });

  it("6. replay identico do mesmo evento e idempotente, sem pagamento duplicado, com processed_at", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);
    const eventId = "evt_replay_" + crypto.randomUUID();

    const args = confirmArgs(order.id, "mock_replay_" + order.id, eventId, order.totalCents, "BRL");
    const first = await service.rpc("confirm_order_payment", args);
    expect(first.error).toBeNull();

    const second = await service.rpc("confirm_order_payment", args);
    expect(second.error).toBeNull();

    expect(await paidPaymentCount(order.id)).toBe(1);

    const { data: evt } = await service
      .from("payment_events")
      .select("processed_at")
      .eq("provider", "mock")
      .eq("provider_event_id", eventId)
      .single();
    expect(evt!.processed_at).not.toBeNull();
  });

  it("7. mesmo provider_event_id apontando para outro pedido recebe PAYMENT_EVENT_MISMATCH", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const orderA = await createOrder(userClient, planId);
    const orderB = await createOrder(userClient, planId);
    const eventId = "evt_cross_" + crypto.randomUUID();

    const first = await service.rpc(
      "confirm_order_payment",
      confirmArgs(orderA.id, "mock_crossA_" + orderA.id, eventId, orderA.totalCents, "BRL"),
    );
    expect(first.error).toBeNull();

    const second = await service.rpc(
      "confirm_order_payment",
      confirmArgs(orderB.id, "mock_crossB_" + orderB.id, eventId, orderB.totalCents, "BRL"),
    );
    expect(second.error).toBeTruthy();
    expect(second.error!.message).toMatch(/PAYMENT_EVENT_MISMATCH/);

    const o = await orderRow(orderB.id);
    expect(o.paid_at).toBeNull();
  });

  it("8. mesmo external_payment_id apontando para outro pedido recebe PAYMENT_ORDER_MISMATCH", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const orderA = await createOrder(userClient, planId);
    const orderB = await createOrder(userClient, planId);
    const externalId = "mock_shared_ext_" + crypto.randomUUID();

    const first = await service.rpc(
      "confirm_order_payment",
      confirmArgs(orderA.id, externalId, "evt_sA_" + crypto.randomUUID(), orderA.totalCents, "BRL"),
    );
    expect(first.error).toBeNull();

    const second = await service.rpc(
      "confirm_order_payment",
      confirmArgs(orderB.id, externalId, "evt_sB_" + crypto.randomUUID(), orderB.totalCents, "BRL"),
    );
    expect(second.error).toBeTruthy();
    expect(second.error!.message).toMatch(/PAYMENT_ORDER_MISMATCH/);

    const o = await orderRow(orderB.id);
    expect(o.paid_at).toBeNull();
  });

  it("9. duas confirmacoes concorrentes do mesmo pedido terminam consistentes com um unico pagamento", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);
    const externalId = "mock_conc_" + order.id;

    const results = await Promise.all([
      service.rpc("confirm_order_payment", confirmArgs(
        order.id, externalId, "evt_c1_" + crypto.randomUUID(), order.totalCents, "BRL")),
      service.rpc("confirm_order_payment", confirmArgs(
        order.id, externalId, "evt_c2_" + crypto.randomUUID(), order.totalCents, "BRL")),
    ]);
    for (const r of results) {
      expect(r.error).toBeNull();
    }

    const o = await orderRow(order.id);
    expect(o.paid_at).not.toBeNull();
    expect(await paidPaymentCount(order.id)).toBe(1);
  });

  it("10. record_payment_intent com amount/currency divergentes do snapshot rejeita", async () => {
    const { client: userClient } = await getIdentity("pa-owner");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const order = await createOrder(userClient, planId);

    const badAmount = await service.rpc("record_payment_intent", {
      p_order_id: order.id,
      p_provider: "mock",
      p_external_payment_id: "mock_int_" + order.id,
      p_amount_cents: order.totalCents - 100,
      p_currency: "BRL",
    });
    expect(badAmount.error).toBeTruthy();
    expect(badAmount.error!.message).toMatch(/AMOUNT_MISMATCH/);

    const badCurrency = await service.rpc("record_payment_intent", {
      p_order_id: order.id,
      p_provider: "mock",
      p_external_payment_id: "mock_int2_" + order.id,
      p_amount_cents: order.totalCents,
      p_currency: "USD",
    });
    expect(badCurrency.error).toBeTruthy();
    expect(badCurrency.error!.message).toMatch(/CURRENCY_MISMATCH/);
  });

  it("11. cross-user: server action de pagamento simulado e bloqueado para pedido de outro usuario", async () => {
    const a = await getIdentity("pa-owner");
    const b = await getIdentity("pa-other");
    const planId = await createFixturePlan(adminClient, 1, 7500);
    const orderB = await createOrder(b.client, planId);

    // O dono errado (A) nao consegue sequer ler o pedido de B via RLS,
    // e as RPCs de pagamento sao service_role-only: sem caminho client-side.
    const { data: foreign } = await a.client
      .from("orders")
      .select("id")
      .eq("id", orderB.id)
      .maybeSingle();
    expect(foreign).toBeNull();

    const { error } = await a.client.rpc(
      "confirm_order_payment",
      confirmArgs(orderB.id, "mock_xu_" + orderB.id, "evt_xu_" + crypto.randomUUID(), orderB.totalCents, "BRL"),
    );
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/permission denied/i);

    const o = await orderRow(orderB.id);
    expect(o.paid_at).toBeNull();
  });
});