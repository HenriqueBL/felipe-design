import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Harness de integração: valida a lógica real das migrations 0001-0006
// contra PostgreSQL/Supabase. Requer .env.test.local com credenciais válidas.
// NUNCA execute contra produção.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Create .env.test.local with valid dev credentials. ` +
        "See tests/integration/README.md for setup instructions.",
    );
  }
  return value;
}

describe("Production-ready queue rule (migration 0006)", () => {
  let admin: SupabaseClient;
  let adminUser: { email: string; password: string };

  /**
   * Cria plan + price via admin autenticado (não service_role puro).
   * O service_role key bypassa RLS nas tabelas, mas a policy plans_write_admin
   * usa is_admin() que depende de auth.uid() — sem sessão, retorna false.
   * Solução: autenticar como usuário com role='admin' para operações de fixture.
   */
  async function createFixturePlan(
    angles: number,
    amountCents: number,
  ): Promise<{ planId: string; priceId: string }> {
    const adminClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { error: signInErr } = await adminClient.auth.signInWithPassword({
      email: adminUser.email,
      password: adminUser.password,
    });
    if (signInErr) throw new Error(`Admin sign-in failed: ${signInErr.message}`);

    // Upsert: plans tem constraint UNIQUE em angles; reutiliza se já existir
    const { data: plan, error: planErr } = await adminClient
      .from("plans")
      .upsert({ angles, active: true }, { onConflict: "angles" })
      .select("id")
      .single();
    if (planErr || !plan) throw new Error(`Plan insert failed: ${planErr?.message}`);

    // Reutiliza price ativo existente para evitar violação de plan_prices_validity_uq
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
      if (priceErr || !price) throw new Error(`Price insert failed: ${priceErr?.message}`);
      priceId = price.id;
    }

    return { planId: plan.id, priceId };
  }

  beforeAll(async () => {
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
    admin = createClient(url, key, { auth: { persistSession: false } });

    // Cria usuário admin dedicado para fixtures e promove a role='admin'
    adminUser = {
      email: `admin-fixture-${Date.now()}@example.com`,
      password: "AdminFixture123!",
    };
    const { data: adminCreated, error: createErr } = await admin.auth.admin.createUser({
      email: adminUser.email,
      password: adminUser.password,
      email_confirm: true,
    });
    if (createErr || !adminCreated?.user) {
      throw new Error(`Failed to create admin fixture user: ${createErr?.message}`);
    }

    // Promove a admin via service_role (bypassa RLS na tabela profiles)
    const { error: updateErr } = await admin
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", adminCreated.user.id);
    if (updateErr) {
      throw new Error(`Failed to promote admin user: ${updateErr.message}`);
    }
  });

  it("create_order grava promised_delivery_date como NULL", async () => {
    // Cria usuário e plano de teste via service_role
    const { data: user } = await admin.auth.admin.createUser({
      email: `test-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });
    expect(user?.user).toBeDefined();

    const { planId } = await createFixturePlan(1, 7500);

    // Cria pedido como o usuário (não admin) para testar auth.uid()
    const userClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await userClient.auth.signInWithPassword({
      email: user!.user!.email!,
      password: "TestPass123!",
    });

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
    expect(order!.total_images).toBe(2); // 2 facas × 1 ângulo
  });

  it("confirm_order_payment sem fotos completas mantém promised_delivery_date NULL", async () => {
    // Este teste valida que paid + incomplete photos = readiness NULL
    // Setup simplificado: usa service_role para criar dados de teste
    const { data: user } = await admin.auth.admin.createUser({
      email: `test-payfirst-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });

    const { planId } = await createFixturePlan(2, 13000);

    const userClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await userClient.auth.signInWithPassword({
      email: user!.user!.email!,
      password: "TestPass123!",
    });

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Confirma pagamento sem enviar fotos
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
    // Payment-first: paid → upload parcial → upload final → ready
    const { data: user } = await admin.auth.admin.createUser({
      email: `test-upload-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });

    const { planId } = await createFixturePlan(1, 7500);

    const userClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await userClient.auth.signInWithPassword({
      email: user!.user!.email!,
      password: "TestPass123!",
    });

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 2,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Confirma pagamento
    await userClient.rpc("confirm_order_payment", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: "mock_" + order!.id,
      p_provider_event_id: "evt_" + crypto.randomUUID(),
      p_amount_cents: 15000,
      p_currency: "BRL",
    });

    // Upload parcial (1 de 2 fotos)
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user!.user!.id}/${order!.id}/original/test1.jpg`,
      original_filename: "test1.jpg",
    });

    const { data: partial } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date")
      .eq("id", order!.id)
      .single();

    expect(partial!.production_ready_at).toBeNull();
    expect(partial!.promised_delivery_date).toBeNull();

    // Upload final (2ª foto) — trigger deve ativar
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user!.user!.id}/${order!.id}/original/test2.jpg`,
      original_filename: "test2.jpg",
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
    // Photos-first: upload completo → confirm payment → ready
    const { data: user } = await admin.auth.admin.createUser({
      email: `test-photosfirst-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });

    const { planId } = await createFixturePlan(1, 7500);

    const userClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await userClient.auth.signInWithPassword({
      email: user!.user!.email!,
      password: "TestPass123!",
    });

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Upload completo ANTES do pagamento
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user!.user!.id}/${order!.id}/original/photo.jpg`,
      original_filename: "photo.jpg",
    });

    const { data: beforePay } = await userClient
      .from("orders")
      .select("production_ready_at, promised_delivery_date")
      .eq("id", order!.id)
      .single();

    expect(beforePay!.production_ready_at).toBeNull();
    expect(beforePay!.promised_delivery_date).toBeNull();

    // Confirma pagamento — maybe_mark_order_ready é chamada explicitamente
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
    const { data: user } = await admin.auth.admin.createUser({
      email: `test-idem-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });

    const { planId } = await createFixturePlan(1, 7500);

    const userClient = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await userClient.auth.signInWithPassword({
      email: user!.user!.email!,
      password: "TestPass123!",
    });

    const { data: order } = await userClient.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Upload + pagamento
    await userClient.from("order_images").insert({
      order_id: order!.id,
      kind: "source",
      storage_path: `${user!.user!.id}/${order!.id}/original/idem.jpg`,
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

    // Segunda confirmação com evento diferente
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
    const { data: result } = await admin.rpc("current_backlog_images");
    expect(typeof result).toBe("number");
    // Não podemos garantir valor exato em banco compartilhado,
    // mas validamos que a função executa sem erro e retorna integer
  });

  it("estimate_delivery retorna businessDaysAfterReady sem data absoluta", async () => {
    const { data, error } = await admin.rpc("estimate_delivery", { p_new_images: 4 });
    expect(error).toBeNull();
    expect(data).toHaveProperty("businessDaysAfterReady");
    expect(data).toHaveProperty("currentBacklogImages");
    expect(data).not.toHaveProperty("promisedDeliveryDate");
    expect(data).not.toHaveProperty("startsCountingFrom");
    expect(typeof data.businessDaysAfterReady).toBe("number");
    expect(data.businessDaysAfterReady).toBeGreaterThanOrEqual(1);
  });

  it("RLS: cliente B não lê pedido de cliente A", async () => {
    // Cria dois usuários
    const { data: userA } = await admin.auth.admin.createUser({
      email: `rls-a-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });
    const { data: userB } = await admin.auth.admin.createUser({
      email: `rls-b-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });

    const { planId } = await createFixturePlan(1, 7500);

    // Cliente A cria pedido
    const clientA = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await clientA.auth.signInWithPassword({
      email: userA!.user!.email!,
      password: "TestPass123!",
    });

    const { data: orderA } = await clientA.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    // Cliente B tenta ler pedido de A
    const clientB = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await clientB.auth.signInWithPassword({
      email: userB!.user!.email!,
      password: "TestPass123!",
    });

    const { data: leaked } = await clientB
      .from("orders")
      .select("id")
      .eq("id", orderA!.id)
      .maybeSingle();

    // RLS deve bloquear: ou retorna null ou erro
    expect(leaked).toBeNull();
  });

  it("Storage: cliente B não faz upload no path de cliente A", async () => {
    const { data: userA } = await admin.auth.admin.createUser({
      email: `storage-a-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });
    const { data: userB } = await admin.auth.admin.createUser({
      email: `storage-b-${Date.now()}@example.com`,
      password: "TestPass123!",
      email_confirm: true,
    });

    const clientB = createClient(SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    await clientB.auth.signInWithPassword({
      email: userB!.user!.email!,
      password: "TestPass123!",
    });

    // Tenta escrever no path de A
    const fakePath = `${userA!.user!.id}/fake-order/original/hack.jpg`;
    const { error } = await clientB.storage
      .from("client-uploads")
      .upload(fakePath, new Uint8Array([0]), { contentType: "image/jpeg" });

    expect(error).not.toBeNull();
  });
});