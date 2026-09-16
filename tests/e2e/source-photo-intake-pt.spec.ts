import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { createTestUser, deleteTestUser, createFreshAdminClient } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/tiny.jpg");

interface IntakeLimits {
  requiredPerKnife: number;
  maxPerKnife: number;
  maxPhotoSizeMb: number;
}

/** Read real intake limits from the order snapshot — never hardcode 3/5/25. */
async function readIntakeLimits(orderId: string): Promise<IntakeLimits> {
  const admin = createFreshAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(
      "required_source_photos_per_knife, max_source_photos_per_knife, max_source_photo_size_mb",
    )
    .eq("id", orderId)
    .single();
  if (error || !data) {
    throw new Error(`INTAKE PT: failed to read order ${orderId}: ${error?.message}`);
  }
  return {
    requiredPerKnife: data.required_source_photos_per_knife,
    maxPerKnife: data.max_source_photos_per_knife,
    maxPhotoSizeMb: data.max_source_photo_size_mb,
  };
}

test.describe("Source Photo Intake — PT-BR labels and errors", () => {
  let customerUserId: string;
  let customerEmail: string;
  let customerPassword: string;
  let planId: string;

  test.beforeAll(async () => {
    const user = await createTestUser("intake-pt", "user");
    customerUserId = user.userId;
    customerEmail = user.email;
    customerPassword = user.password;
    planId = (await getOrCreateTestPlan()).id;
  });

  test.afterAll(async () => {
    if (customerUserId) {
      await cleanupUserData(customerUserId);
      await deleteTestUser(customerUserId).catch(() => {});
    }
  });

  test("PT locale: labels, counter, invalid type, oversized, max photos, submit", async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // Create order via PT checkout
    await authenticateWithSSR(page, customerEmail, customerPassword);
    await page.goto(`/pt/finalizar?plan=${planId}&qty=1&currency=USD&key=${randomUUID()}`);
    const createBtn = page.locator("main").getByRole("button", { name: /criar pedido|create order/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await expect(page).toHaveURL(/\/pt\/conta\/(pedidos|orders)\//, { timeout: 15_000 });

    const orderIdMatch = page.url().match(/(?:pedidos|orders)\/([0-9a-f-]+)/);
    if (!orderIdMatch) throw new Error("INTAKE PT: orderId not found in URL");
    const orderId = orderIdMatch[1]!;

    // Snapshot-driven limits
    const { requiredPerKnife, maxPerKnife, maxPhotoSizeMb } = await readIntakeLimits(orderId);

    // Mock payment (PT button), then reload
    const payBtn = page.locator('button:has-text("Simular pagamento"), button:has-text("Simulate payment")');
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();
    await expect(page.locator(".badge.awaiting_photos")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // ─── PT labels ───
    await expect(page.locator("h3", { hasText: "Envie suas fotos" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".source-photo-upload p").first()).toContainText(
      `${maxPhotoSizeMb} MB por foto`,
    );
    const heading = page.locator(".source-photo-knife h4").first();
    await expect(heading).toContainText("Faca 1");
    await expect(heading).toContainText(`0 / ${maxPerKnife} fotos`);
    await expect(page.locator('label:has-text("Adicionar fotos")')).toBeVisible();

    const finishBtn = page.locator('button:has-text("Finalizar envio das fotos")');
    await expect(finishBtn).toBeDisabled();

    // ─── Invalid file type (PT message) ───
    const invalidFile = {
      name: "documento.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("nao e imagem"),
    };
    await page.locator('input[type="file"]').first().setInputFiles(invalidFile);
    await expect(page.locator(".source-photo-knife .note.error, .source-photo-list .note.error").first())
      .toContainText(/Somente arquivos JPG, JPEG, PNG e WebP são aceitos/, { timeout: 10_000 });
    // Counter unchanged
    await expect(heading).toContainText(`0 / ${maxPerKnife} fotos`);

    // ─── Oversized file (PT message) ───
    const oversizeBytes = maxPhotoSizeMb * 1024 * 1024 + 1024;
    const oversizeFile = {
      name: "grande.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(oversizeBytes, 1),
    };
    await page.locator('input[type="file"]').first().setInputFiles(oversizeFile);
    await expect(page.locator(".source-photo-knife .note.error, .source-photo-list .note.error").first())
      .toContainText(`Arquivos devem ter até ${maxPhotoSizeMb} MB`, { timeout: 10_000 });
    await expect(heading).toContainText(`0 / ${maxPerKnife} fotos`);

    // ─── Valid upload to minimum: counter + finish enabled ───
    const files: string[] = [];
    for (let i = 0; i < requiredPerKnife; i++) files.push(FIXTURE_IMAGE);
    await page.locator('input[type="file"]').first().setInputFiles(files);
    await expect
      .poll(async () => page.locator(".source-photo-item").count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(requiredPerKnife);
    await expect(heading).toContainText(`${requiredPerKnife} / ${maxPerKnife} fotos`, { timeout: 15_000 });
    await expect(finishBtn).toBeEnabled();

    // ─── Max photos exceeded (PT notice) ───
    // Selecting more than remaining capacity shows "apenas mais N foto(s)";
    // the accepted slice fills the knife to max, and at capacity the static
    // note "Você atingiu o número máximo de fotos para esta faca." appears.
    const excess = maxPerKnife + 2;
    const excessFiles: string[] = [];
    for (let i = 0; i < excess; i++) excessFiles.push(FIXTURE_IMAGE);
    await page.locator('input[type="file"]').first().setInputFiles(excessFiles);
    await expect(page.locator(".source-photo-knife .note.error").first())
      .toContainText(/Você pode adicionar apenas mais \d+ foto/, { timeout: 15_000 });
    await expect
      .poll(async () => page.locator(".source-photo-item").count(), { timeout: 60_000 })
      .toBe(maxPerKnife);
    await expect(heading).toContainText(`${maxPerKnife} / ${maxPerKnife} fotos`, { timeout: 30_000 });
    await expect(
      page.locator(".source-photo-knife .note").filter({
        hasText: "Você atingiu o número máximo de fotos para esta faca.",
      }),
    ).toBeVisible({ timeout: 10_000 });

    // ─── Finish: PT confirm dialog → Fotos enviadas (read-only) ───
    // Register the handler without awaiting — awaiting a promise that only
    // resolves AFTER the click would deadlock the test.
    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });
    await finishBtn.click();
    expect(dialogMessage).toContain("não poderá adicionar");
    await expect(page.locator('text="Fotos enviadas"')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('label:has-text("Adicionar fotos")')).not.toBeVisible();
    await expect(page.locator('button:has-text("Finalizar envio das fotos")')).not.toBeVisible();

    const admin = createFreshAdminClient();
    const { data: order } = await admin
      .from("orders")
      .select("source_photos_submitted_at")
      .eq("id", orderId)
      .single();
    expect(order?.source_photos_submitted_at).not.toBeNull();

    await ctx.close();
  });

  test("PT locale: upload failure shows error and counter stays unchanged", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    await authenticateWithSSR(page, customerEmail, customerPassword);
    await page.goto(`/pt/finalizar?plan=${planId}&qty=1&currency=USD&key=${randomUUID()}`);
    const createBtn = page.locator("main").getByRole("button", { name: /criar pedido|create order/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await expect(page).toHaveURL(/\/pt\/conta\/(pedidos|orders)\//, { timeout: 15_000 });

    const orderIdMatch = page.url().match(/(?:pedidos|orders)\/([0-9a-f-]+)/);
    if (!orderIdMatch) throw new Error("INTAKE PT: orderId not found in URL");

    const { requiredPerKnife, maxPerKnife } = await readIntakeLimits(orderIdMatch[1]!);

    const payBtn = page.locator('button:has-text("Simular pagamento"), button:has-text("Simulate payment")');
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();
    await expect(page.locator(".badge.awaiting_photos")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Abort only the TUS resumable upload endpoint — a real network-level upload
    // failure without breaking app hydration or server actions. The endpoint
    // lives on the project host <ref>.supabase.co, not a storage.* subdomain.
    // tus retries 5 times (~38s of delays) before the job is marked failed.
    test.setTimeout(180_000);
    await page.route(/\/storage\/v1\/upload\/resumable/, async (route) => {
      await route.abort("failed");
    });

    const heading = page.locator(".source-photo-knife h4").first();
    await expect(heading).toContainText(`0 / ${maxPerKnife} fotos`);

    await page.locator('input[type="file"]').first().setInputFiles([FIXTURE_IMAGE]);
    // Job fails (Falhou) and the counter never counts a failed job.
    await expect(page.locator(".source-photo-item.job-failed")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(".source-photo-item.job-failed .note.error")).toContainText(
      /Falha|conexão|errado/i,
    );
    await expect(heading).toContainText(`0 / ${maxPerKnife} fotos`, { timeout: 10_000 });

    await ctx.close();
  });
});