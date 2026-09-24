import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";
import { createFreshAdminClient } from "./helpers/auth";

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/tiny.jpg");

interface TestState {
  customerUserId: string;
  customerEmail: string;
  customerPassword: string;
  planId: string;
}

/**
 * Create an order directly via the app UI (checkout flow), then return its ID.
 * Mirrors the customer journey but stops at order creation (unpaid).
 */
async function createOrderViaCheckout(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
  planId: string,
  knifeQuantity: number,
): Promise<string> {
  const checkoutUrl =
    `/en/checkout?plan=${planId}&qty=${knifeQuantity}&currency=USD&key=${randomUUID()}`;
  await authenticateWithSSR(page, email, password);
  await page.setExtraHTTPHeaders({ "x-test-country": "US" });
  await page.goto(checkoutUrl);
  await expect(page).toHaveURL(/\/en\/checkout/, { timeout: 15_000 });

  page.on("pageerror", (err) => console.log("[PAGEERROR]", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[CONSOLE]", msg.text());
  });

  const createBtn = page.locator("main").getByRole("button", { name: /create order/i });
  await expect(createBtn).toBeVisible({ timeout: 10_000 });
  await createBtn.click();

  await expect(page).toHaveURL(/\/en\/account\/orders\//, { timeout: 15_000 });
  const match = page.url().match(/orders\/([0-9a-f-]+)/);
  if (!match) throw new Error("INTAKE E2E: orderId not found in URL");
  return match[1]!;
}

async function simulatePayment(
  page: import("@playwright/test").Page,
  expectedBadge = ".badge.awaiting_photos",
): Promise<void> {
  const payBtn = page.locator('button:has-text("Simulate payment")');
  await expect(payBtn).toBeVisible({ timeout: 10_000 });
  await payBtn.click();
  await expect(page.locator(expectedBadge)).toBeVisible({ timeout: 30_000 });
}

/** Read real order state from server (never trust client-side status). */
async function readOrderState(orderId: string): Promise<{
  paid: boolean;
  submitted: boolean;
  status: string;
  productionReadyAt: string | null;
  promisedDeliveryDate: string | null;
}> {
  const admin = createFreshAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select("status, paid_at, source_photos_submitted_at, production_ready_at, promised_delivery_date")
    .eq("id", orderId)
    .single();
  if (error || !data) throw new Error(`INTAKE E2E: failed to read order ${orderId}: ${error?.message}`);
  return {
    paid: data.paid_at !== null,
    submitted: data.source_photos_submitted_at !== null,
    status: data.status,
    productionReadyAt: data.production_ready_at,
    promisedDeliveryDate: data.promised_delivery_date,
  };
}

async function countSourcePhotos(orderId: string, knifeIndex: number): Promise<number> {
  const admin = createFreshAdminClient();
  const { data, error } = await admin
    .from("order_images")
    .select("id")
    .eq("order_id", orderId)
    .eq("kind", "source")
    .eq("knife_index", knifeIndex);
  if (error) throw new Error(`INTAKE E2E: source_images query failed: ${error.message}`);
  return data?.length ?? 0;
}

async function uploadToKnife(
  page: import("@playwright/test").Page,
  knifeIndex: number,
  fileCount: number,
): Promise<void> {
  // Each knife group has its own hidden file input, in DOM order.
  const input = page.locator('input[type="file"]').nth(knifeIndex - 1);
  await expect(input).toBeAttached({ timeout: 10_000 });
  const files: string[] = [];
  for (let i = 0; i < fileCount; i++) files.push(FIXTURE_IMAGE);

  await input.setInputFiles(files);
  // Jobs completed with a persisted image are rendered as registered
  // photos, not as job rows — so wait on the knife group's item count.
  const group = page.locator(".source-photo-knife").nth(knifeIndex - 1);
  await expect
    .poll(async () => group.locator(".source-photo-item").count(), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(fileCount);
}

function expectCounter(page: import("@playwright/test").Page, knifeIndex: number, count: number): Promise<void> {
  const heading = page.locator(".source-photo-knife h4").nth(knifeIndex - 1);
  return expect(heading).toContainText(`${count} / 5`, { timeout: 30_000 });
}

async function removeOnePhoto(page: import("@playwright/test").Page): Promise<void> {
  const removeBtn = page.locator(".source-photo-item button:has-text('Remove')").first();
  await expect(removeBtn).toBeVisible({ timeout: 10_000 });
  // Snapshot the count BEFORE clicking: after deletion the list has one
  // fewer item. (Locators are live — re-resolving ".." after the click
  // would target the NEXT item's parent, which stays visible by design.)
  const beforeCount = await page.locator(".source-photo-item").count();
  expect(beforeCount).toBeGreaterThan(0);
  page.once("dialog", (dialog) => dialog.accept());
  await removeBtn.click();
  await expect
    .poll(async () => page.locator(".source-photo-item").count(), { timeout: 15_000 })
    .toBe(beforeCount - 1);
}

test.describe("Source Photo Intake — focused", () => {
  let state: TestState;

  test.beforeAll(async () => {
    const user = await createTestUser("intake", "user");
    state = {
      customerUserId: user.userId,
      customerEmail: user.email,
      customerPassword: user.password,
      planId: (await getOrCreateTestPlan()).id,
    };
  });

  test.afterAll(async () => {
    if (state?.customerUserId) {
      await cleanupUserData(state.customerUserId);
      await deleteTestUser(state.customerUserId).catch(() => {});
    }
  });

  test("single knife: upload, delete, finish enable/disable, submit → read-only (payment first)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const orderId = await createOrderViaCheckout(page, state.customerEmail, state.customerPassword, state.planId, 1);

    // PAYMENT FIRST
    await simulatePayment(page);
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Initial: 0 / 5, Finish disabled
    await expectCounter(page, 1, 0);
    const finishBtn = page.locator('button:has-text("Finish photo submission")');
    await expect(finishBtn).toBeDisabled();

    // Upload 1: 1 / 5, still disabled
    await uploadToKnife(page, 1, 1);
    await expectCounter(page, 1, 1);
    await expect(finishBtn).toBeDisabled();

    // Upload 2 more: 3 / 5, Finish enabled
    await uploadToKnife(page, 1, 2);
    await expectCounter(page, 1, 3);
    await expect(finishBtn).toBeEnabled();

    // Upload 4th: 4 / 5, still enabled
    await uploadToKnife(page, 1, 1);
    await expectCounter(page, 1, 4);
    await expect(finishBtn).toBeEnabled();

    // Delete one: 3 / 5 still enabled; delete another: 2 / 5 disabled
    await removeOnePhoto(page);
    await expectCounter(page, 1, 3);
    await removeOnePhoto(page);
    await expectCounter(page, 1, 2);
    await expect(finishBtn).toBeDisabled();

    // Re-add to minimum, then submit
    await uploadToKnife(page, 1, 1);
    await expectCounter(page, 1, 3);
    await expect(finishBtn).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await finishBtn.click();

    // Read-only: submitted note visible, controls gone, thumbnails remain
    await expect(page.locator('text="Photos submitted"')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".source-photo-item img.source-photo-thumb").first()).toBeVisible();
    await expect(page.locator('label:has-text("Add photos")')).not.toBeVisible();
    await expect(page.locator(".source-photo-item button:has-text('Remove')")).not.toBeVisible();
    await expect(page.locator('button:has-text("Finish photo submission")')).not.toBeVisible();

    // Server state: submitted, paid, and (per 0008 + 0006) order becomes production-ready
    const snapshot = await readOrderState(orderId);
    expect(snapshot.submitted).toBe(true);
    expect(snapshot.paid).toBe(true);
    expect(snapshot.status).not.toBe("awaiting_payment");
    expect(snapshot.status).not.toBe("cancelled");
    expect(snapshot.productionReadyAt).not.toBeNull();
    expect(snapshot.promisedDeliveryDate).not.toBeNull();
    expect(snapshot.productionReadyAt).not.toBeNull();
    expect(snapshot.promisedDeliveryDate).not.toBeNull();

    // Server-side photo count matches minimum
    expect(await countSourcePhotos(orderId, 1)).toBeGreaterThanOrEqual(3);

    await ctx.close();
  });

  test("multi knife: independent groups, cross-knife isolation, submit → both read-only", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const orderId = await createOrderViaCheckout(page, state.customerEmail, state.customerPassword, state.planId, 2);

    await simulatePayment(page);
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Two groups rendered
    await expect(page.locator(".source-photo-knife")).toHaveCount(2);

    // Knife 1: 3 photos, Knife 2: 2 photos → Finish disabled
    await uploadToKnife(page, 1, 3);
    await uploadToKnife(page, 2, 2);
    await expectCounter(page, 1, 3);
    await expectCounter(page, 2, 2);
    const finishBtn = page.locator('button:has-text("Finish photo submission")');
    await expect(finishBtn).toBeDisabled();

    // Add 3rd photo to Knife 2 → Finish enabled
    await uploadToKnife(page, 2, 1);
    await expectCounter(page, 2, 3);
    await expect(finishBtn).toBeEnabled();

    // Cross-knife isolation: server counts stay per knife_index
    expect(await countSourcePhotos(orderId, 1)).toBe(3);
    expect(await countSourcePhotos(orderId, 2)).toBe(3);

    // Filenames rendered in each group never cross over (same fixture name, so
    // verify by count per group instead: group 1 shows exactly 3 items).
    await expect(page.locator(".source-photo-knife").nth(0).locator(".source-photo-item")).toHaveCount(3);
    await expect(page.locator(".source-photo-knife").nth(1).locator(".source-photo-item")).toHaveCount(3);

    page.once("dialog", (dialog) => dialog.accept());
    await finishBtn.click();

    await expect(page.locator('text="Photos submitted"')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('label:has-text("Add photos")')).not.toBeVisible();
    await expect(page.locator(".source-photo-item button:has-text('Remove')")).not.toBeVisible();

    const snapshot = await readOrderState(orderId);
    expect(snapshot.submitted).toBe(true);
    expect(snapshot.paid).toBe(true);

    await ctx.close();
  });

  test("photos first: submit before payment, then pay → production queue", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const orderId = await createOrderViaCheckout(page, state.customerEmail, state.customerPassword, state.planId, 1);

    // Order is unpaid — upload area is available (intake open before payment).
    await expect(page.locator(".source-photo-upload")).toBeVisible({ timeout: 10_000 });
    await expectCounter(page, 1, 0);

    // PHOTOS FIRST: upload to minimum and submit while unpaid
    await uploadToKnife(page, 1, 3);
    await expectCounter(page, 1, 3);
    const finishBtn = page.locator('button:has-text("Finish photo submission")');
    await expect(finishBtn).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await finishBtn.click();
    await expect(page.locator('text="Photos submitted"')).toBeVisible({ timeout: 30_000 });

    // Server state: submitted but NOT paid yet
    const before = await readOrderState(orderId);
    expect(before.submitted).toBe(true);
    expect(before.paid).toBe(false);

    // Then confirm payment via existing mock mechanism
    // Photos already submitted: after payment the order goes straight to
    // the production queue (no awaiting_photos badge).
    await simulatePayment(page, ".badge.in_queue");
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Both conditions met → order leaves awaiting_payment for the queue
    const after = await readOrderState(orderId);
    expect(after.paid).toBe(true);
    expect(after.submitted).toBe(true);
    expect(after.status).not.toBe("awaiting_payment");
    expect(after.productionReadyAt).not.toBeNull();
    expect(after.promisedDeliveryDate).not.toBeNull();
    await expect(page.locator(".badge.in_queue")).toBeVisible();

    await ctx.close();
  });

  test("PT locale labels: Faca, fotos, Finalizar envio das fotos, Fotos enviadas", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await authenticateWithSSR(page, state.customerEmail, state.customerPassword);
    const planId = state.planId;
    const key = randomUUID();
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto(`/pt/finalizar?plan=${planId}&qty=1&currency=USD&key=${key}`);
    // PT rewrites map to the English checkout slug internally.
    await expect(page).toHaveURL(/\/pt\//, { timeout: 15_000 });

    const createBtn = page.locator("main").getByRole("button", { name: /criar pedido|create order/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await expect(page).toHaveURL(/\/pt\/conta\/(pedidos|orders)\//, { timeout: 15_000 });

    await simulatePaymentPT(page);
    await page.reload();
    await page.waitForLoadState("networkidle");

    // PT labels on the intake area
    await expect(page.locator("h4", { hasText: /Faca 1/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".source-photo-knife h4").first()).toContainText(/0 \/ 5 fotos/);
    await expect(page.locator('button:has-text("Finalizar envio das fotos")')).toBeDisabled();

    // Upload to minimum in PT
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles([FIXTURE_IMAGE, FIXTURE_IMAGE, FIXTURE_IMAGE]);
    // Functional state, not implementation: completed jobs become persisted
    // images (.source-photo-item without a job-* suffix).
    await expect
      .poll(async () => page.locator(".source-photo-item").count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(3);
    await expect(page.locator(".source-photo-knife h4").first()).toContainText(/3 \/ 5 fotos/, { timeout: 30_000 });
    await expect(page.locator('button:has-text("Finalizar envio das fotos")')).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator('button:has-text("Finalizar envio das fotos")').click();
    await expect(page.locator('text="Fotos enviadas"')).toBeVisible({ timeout: 30_000 });

    const match = page.url().match(/orders\/([0-9a-f-]+)/);
    if (match) {
      const snapshot = await readOrderState(match[1]!);
      expect(snapshot.submitted).toBe(true);
    }

    await ctx.close();
  });
});

async function simulatePaymentPT(page: import("@playwright/test").Page): Promise<void> {
  const payBtn = page.locator('button:has-text("Simular pagamento"), button:has-text("Simulate payment")');
  await expect(payBtn).toBeVisible({ timeout: 10_000 });
  await payBtn.click();
  await expect(page.locator(".badge.awaiting_photos")).toBeVisible({ timeout: 30_000 });
}