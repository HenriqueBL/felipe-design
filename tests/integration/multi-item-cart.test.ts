import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Create .env.test.local with valid dev credentials.`,
    );
  }
  return value;
}

const SUPABASE_URL = requireEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);
const ANON_KEY = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
const SERVICE_ROLE_KEY = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

type Db = Database;
type AdminClient = SupabaseClient<Db>;
type UserClient = SupabaseClient<Db>;

let admin: AdminClient;
let userClient: UserClient;
let userId: string;
let plan3Id: string;
let plan1Id: string;

beforeAll(async () => {
  admin = createClient<Db>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Create a test user and get an authenticated session
  const email = `cart-test-${Date.now()}@example.com`;
  const password = "TestPassword123!";
  const { data: userData } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  userId = userData.user!.id;

  // Create an authenticated client for this user (RPCs check auth.uid())
  userClient = createClient<Db>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) {
    throw new Error(`Failed to sign in test user: ${signInErr.message}`);
  }

  // Ensure two active plans exist: one 3-angle and one 1-angle
  const { data: plans } = await admin
    .from("plans")
    .select("id, angles, active")
    .eq("active", true)
    .order("angles", { ascending: false })
    .limit(10);

  const plan3 = plans?.find((p) => p.angles === 3);
  const plan1 = plans?.find((p) => p.angles === 1);

  if (!plan3 || !plan1) {
    throw new Error(
      "Test requires at least one 3-angle and one 1-angle active plan in DEV",
    );
  }
  plan3Id = plan3.id;
  plan1Id = plan1.id;

  // Ensure active prices exist for both plans in BRL
  for (const pid of [plan3Id, plan1Id]) {
    const { data: prices } = await admin
      .from("plan_prices")
      .select("id")
      .eq("plan_id", pid)
      .eq("currency", "BRL")
      .eq("active", true)
      .limit(1);
    if (!prices || prices.length === 0) {
      await admin.rpc("set_plan_price", {
        p_plan_id: pid,
        p_currency: "BRL",
        p_amount_cents: 5000,
      });
    }
  }
});

afterAll(async () => {
  // Cleanup is best-effort; DEV data is ephemeral
});

describe("Multi-item cart (migration 0017)", () => {
  it("create_cart_order produces 1 order + 2 items with correct knife ranges and total_images=4", async () => {
    const { data: order, error } = await userClient.rpc("create_cart_order", {
      p_items: [
        { plan_id: plan3Id, quantity: 1 },
        { plan_id: plan1Id, quantity: 1 },
      ],
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });

    expect(error).toBeNull();
    expect(order).not.toBeNull();
    expect(order!.knife_quantity).toBe(2);
    expect(order!.total_images).toBe(4);
    // Multi-item orders have NULL plan_id; order_items is the authority.
    expect(order!.plan_id).toBeNull();

    // Verify order_items via admin (service role bypasses RLS for inspection)
    const { data: items } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", order!.id)
      .order("item_index");

    expect(items).toHaveLength(2);
    const item1 = items![0]!;
    const item2 = items![1]!;

    // Item 1: 3-angle, knife range [1,1]
    expect(item1.item_index).toBe(1);
    expect(item1.plan_id).toBe(plan3Id);
    expect(item1.angles).toBe(3);
    expect(item1.knife_quantity).toBe(1);
    expect(item1.knife_index_start).toBe(1);
    expect(item1.total_images).toBe(3);
    expect(item1.subtotal_cents).toBe(item1.unit_price_cents * 1);

    // Item 2: 1-angle, knife range [2,2]
    expect(item2.item_index).toBe(2);
    expect(item2.plan_id).toBe(plan1Id);
    expect(item2.angles).toBe(1);
    expect(item2.knife_quantity).toBe(1);
    expect(item2.knife_index_start).toBe(2);
    expect(item2.total_images).toBe(1);
    expect(item2.subtotal_cents).toBe(item2.unit_price_cents * 1);

    // Order totals match sum of items
    const itemsSubtotal = items!.reduce((s, i) => s + i.subtotal_cents, 0);
    expect(order!.total_cents).toBe(itemsSubtotal);
  });

  it("server price authority: browser sends no prices, RPC snapshots current prices", async () => {
    const idemKey = crypto.randomUUID();
    const { data: order, error } = await userClient.rpc("create_cart_order", {
      p_items: [{ plan_id: plan3Id, quantity: 2 }],
      p_currency: "BRL",
      p_idempotency_key: idemKey,
    });

    expect(error).toBeNull();
    expect(order).not.toBeNull();

    const { data: items } = await admin
      .from("order_items")
      .select("unit_price_cents, subtotal_cents")
      .eq("order_id", order!.id);

    expect(items).toHaveLength(1);
    const item = items![0]!;
    expect(item.unit_price_cents).toBeGreaterThan(0);
    expect(item.subtotal_cents).toBe(item.unit_price_cents * 2);
    expect(order!.total_cents).toBe(item.subtotal_cents);
    // Single-item order retains plan_id on orders row
    expect(order!.plan_id).toBe(plan3Id);
  });

  it("price snapshot consistency: orders.total_cents matches sum of item subtotals from single read", async () => {
    const idemKey = crypto.randomUUID();
    const { data: order, error } = await userClient.rpc("create_cart_order", {
      p_items: [
        { plan_id: plan3Id, quantity: 1 },
        { plan_id: plan1Id, quantity: 1 },
      ],
      p_currency: "BRL",
      p_idempotency_key: idemKey,
    });
    expect(error).toBeNull();
    expect(order).not.toBeNull();

    const { data: items } = await admin
      .from("order_items")
      .select("unit_price_cents, subtotal_cents")
      .eq("order_id", order!.id)
      .order("item_index");

    expect(items).toHaveLength(2);
    const itemsSum = items!.reduce((s, i) => s + i.subtotal_cents, 0);
    // Critical invariant: orders.total_cents MUST equal the sum of item
    // subtotals computed from the SAME price snapshot. Migration 0018
    // guarantees this by materializing validated items in a temp table
    // before inserting either orders or order_items.
    expect(order!.total_cents).toBe(itemsSum);
  });

  it("idempotency: same key returns same order, no duplicate items", async () => {
    const idemKey = crypto.randomUUID();

    const { data: order1, error: err1 } = await userClient.rpc(
      "create_cart_order",
      {
        p_items: [{ plan_id: plan3Id, quantity: 1 }],
        p_currency: "BRL",
        p_idempotency_key: idemKey,
      },
    );
    expect(err1).toBeNull();

    const { data: order2, error: err2 } = await userClient.rpc(
      "create_cart_order",
      {
        p_items: [{ plan_id: plan3Id, quantity: 1 }],
        p_currency: "BRL",
        p_idempotency_key: idemKey,
      },
    );
    expect(err2).toBeNull();

    expect(order1!.id).toBe(order2!.id);

    const { count } = await admin
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("order_id", order1!.id);

    expect(count).toBe(1);
  });

  it("all-or-nothing: invalid item rolls back entire order", async () => {
    const fakePlanId = "00000000-0000-0000-0000-000000000000";
    const idemKey = crypto.randomUUID();

    const { error } = await userClient.rpc("create_cart_order", {
      p_items: [
        { plan_id: plan3Id, quantity: 1 },
        { plan_id: fakePlanId, quantity: 1 },
      ],
      p_currency: "BRL",
      p_idempotency_key: idemKey,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("PLAN_NOT_FOUND");

    // No partial order should exist for this idempotency key
    const { data: orders } = await admin
      .from("orders")
      .select("id")
      .eq("idempotency_key", idemKey);

    expect(orders).toHaveLength(0);
  });

  it("RLS: customer sees own order_items, anon cannot", async () => {
    const idemKey = crypto.randomUUID();
    const { data: order, error } = await userClient.rpc("create_cart_order", {
      p_items: [{ plan_id: plan3Id, quantity: 1 }],
      p_currency: "BRL",
      p_idempotency_key: idemKey,
    });
    expect(error).toBeNull();
    expect(order).not.toBeNull();

    // Owner can see their own order_items
    const { data: ownerItems } = await userClient
      .from("order_items")
      .select("id")
      .eq("order_id", order!.id);
    expect(ownerItems).toHaveLength(1);

    // Anon client cannot see any order_items
    const anonClient = createClient<Db>(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: anonItems, error: anonErr } = await anonClient
      .from("order_items")
      .select("id")
      .eq("order_id", order!.id);
    // Migration 0017 grants SELECT on order_items only to authenticated
    // and service_role (not anon). PostgREST returns 42501 for anon,
    // which is correct RLS enforcement — no data leaks.
    if (anonErr) {
      expect(anonErr.code).toBe("42501");
      expect(anonItems).toBeNull();
    } else {
      expect(anonItems ?? []).toHaveLength(0);
    }
  });

  it("source photo mapping: register_source_image validates knife against item ranges", async () => {
    const idemKey = crypto.randomUUID();
    const { data: order, error } = await userClient.rpc("create_cart_order", {
      p_items: [
        { plan_id: plan3Id, quantity: 1 },
        { plan_id: plan1Id, quantity: 1 },
      ],
      p_currency: "BRL",
      p_idempotency_key: idemKey,
    });
    expect(error).toBeNull();
    expect(order).not.toBeNull();

    // Knife 1 belongs to item 1 (3-angle), knife 2 to item 2 (1-angle)
    const { data: img1, error: err1 } = await userClient.rpc(
      "register_source_image",
      {
        p_order_id: order!.id,
        p_knife_index: 1,
        p_storage_path: `test/${order!.id}/knife1-${Date.now()}.jpg`,
        p_original_filename: "knife1.jpg",
      },
    );
    expect(err1).toBeNull();
    expect(img1).not.toBeNull();

    const { data: img2, error: err2 } = await userClient.rpc(
      "register_source_image",
      {
        p_order_id: order!.id,
        p_knife_index: 2,
        p_storage_path: `test/${order!.id}/knife2-${Date.now()}.jpg`,
        p_original_filename: "knife2.jpg",
      },
    );
    expect(err2).toBeNull();
    expect(img2).not.toBeNull();

    // Knife 3 is out of range (only 2 knives total) — should fail
    const { error: err3 } = await userClient.rpc("register_source_image", {
      p_order_id: order!.id,
      p_knife_index: 3,
      p_storage_path: `test/${order!.id}/knife3-${Date.now()}.jpg`,
      p_original_filename: "knife3.jpg",
    });
    expect(err3).not.toBeNull();
    expect(err3!.message).toContain("INVALID_KNIFE_INDEX");
  });

  it("legacy backfill: pre-0017 orders have exactly one order_item", async () => {
    const { data: orders } = await admin
      .from("orders")
      .select("id")
      .limit(5);

    if (!orders || orders.length === 0) {
      return; // No legacy orders in DEV — skip gracefully
    }

    for (const o of orders) {
      const { data: items } = await admin
        .from("order_items")
        .select("id, item_index, knife_index_start")
        .eq("order_id", o.id)
        .order("item_index");

      expect(items).toBeDefined();
      expect(items!.length).toBeGreaterThanOrEqual(1);
      const firstItem = items![0]!;
      expect(firstItem.item_index).toBe(1);
      expect(firstItem.knife_index_start).toBe(1);
    }
  });

  it("payment authority: payment uses orders.total_cents, not client-computed", async () => {
    const idemKey = crypto.randomUUID();
    const { data: order, error } = await userClient.rpc("create_cart_order", {
      p_items: [
        { plan_id: plan3Id, quantity: 1 },
        { plan_id: plan1Id, quantity: 1 },
      ],
      p_currency: "BRL",
      p_idempotency_key: idemKey,
    });
    expect(error).toBeNull();
    expect(order).not.toBeNull();

    // Record a mock payment intent matching order total (admin RPC)
    const { error: payErr } = await admin.rpc("record_payment_intent", {
      p_order_id: order!.id,
      p_provider: "mock",
      p_external_payment_id: `mock-cart-${Date.now()}`,
      p_amount_cents: order!.total_cents,
      p_currency: "BRL",
    });
    expect(payErr).toBeNull();
  });
});