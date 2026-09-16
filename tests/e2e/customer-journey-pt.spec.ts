import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/tiny.jpg");

interface TestState {
  customerUserId: string;
  customerEmail: string;
  customerPassword: string;
  adminUserId: string;
  adminEmail: string;
  adminPassword: string;
  planId: string;
  planAngles: number;
  priceCentsBrl: number;
}

test.describe("Complete Customer Journey — PT-BR", () => {
  let state: TestState;

  test.beforeAll(async () => {
    const customer = await createTestUser("cust-pt", "user");
    const admin = await createTestUser("admin-pt", "admin");
    const plan = await getOrCreateTestPlan();

    state = {
      customerUserId: customer.userId,
      customerEmail: customer.email,
      customerPassword: customer.password,
      adminUserId: admin.userId,
      adminEmail: admin.email,
      adminPassword: admin.password,
      planId: plan.id,
      planAngles: plan.angles,
      priceCentsBrl: plan.priceCentsBrl,
    };
  });

  test.afterAll(async () => {
    if (state?.customerUserId) {
      await cleanupUserData(state.customerUserId);
      await deleteTestUser(state.customerUserId).catch(() => {});
    }
    if (state?.adminUserId) {
      await cleanupUserData(state.adminUserId);
      await deleteTestUser(state.adminUserId).catch(() => {});
    }
  });

  test("full PT journey: visitor → serviços → auth → finalizar → upload → payment → admin → resultado → download → revisão", async ({ browser }) => {
    // ─── STEP A: Visitor lands on PT homepage ───
    const customerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const customerPage = await customerContext.newPage();

    await customerPage.goto("/pt");
    await expect(customerPage.locator("html")).toHaveAttribute("lang", "pt");
    await expect(customerPage).toHaveTitle(/Felipe Design/);

    // ─── STEP B: Navigate to /pt/servicos (canonical route) ───
    await customerPage.click('a[href*="servicos"], nav >> text=/serviços/i');
    await expect(customerPage).toHaveURL(/\/pt\/servicos/);
    await expect(customerPage.locator("h1")).toContainText(/serviços/i);

    // Verify plan card with BRL price
    const planCard = customerPage.locator(".plan-card, [data-plan]").first();
    await expect(planCard).toBeVisible({ timeout: 10_000 });

    // Verify BRL currency is displayed (not USD)
    const priceText = await planCard.textContent();
    expect(priceText).toMatch(/R\$/);

    // ─── STEP C: Choose plan → navigate to /pt/finalizar (canonical checkout) ───
    const chooseBtn = customerPage.locator('a[href*="finalizar"], button:has-text("Escolher"), a:has-text("Escolher")').first();
    await chooseBtn.click();
    await expect(customerPage).toHaveURL(/\/pt\/finalizar/);

    // Verify checkout shows order summary in PT
    await expect(customerPage.locator("main")).toContainText(/confirmar|resumo do pedido/i);

    // Verify BRL price in checkout
    const checkoutContent = await customerPage.locator("main").textContent();
    expect(checkoutContent).toMatch(/R\$/);

    // ─── STEP D: Authentication via SSR cookies ───
    const checkoutUrlWithIntent = customerPage.url();
    expect(checkoutUrlWithIntent).toMatch(/plan=/);

    await authenticateWithSSR(customerPage, state.customerEmail, state.customerPassword);

    // Navigate back to checkout with intent preserved
    await customerPage.goto(checkoutUrlWithIntent);
    await expect(customerPage).toHaveURL(/\/pt\/finalizar/, { timeout: 15_000 });

    // ─── STEP E: Create order ───
    // Scope to main: the header now renders a Sign out <button type="submit">.
    const createBtn = customerPage.locator("main").getByRole("button", { name: /criar pedido/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // Should redirect to /pt/conta/pedidos/<orderId>
    await expect(customerPage).toHaveURL(/\/pt\/conta\/pedidos\//, { timeout: 15_000 });

    const orderUrl = customerPage.url();
    const orderIdMatch = orderUrl.match(/pedidos\/([0-9a-f-]+)/);
    expect(orderIdMatch).toBeTruthy();
    const orderId = orderIdMatch![1];

    // Verify order detail page in PT
    await expect(customerPage.locator("main")).toContainText(/pedido/i);

    // ─── STEP F: Mock Payment (before upload per business rules) ───
    const payBtn = customerPage.locator('button:has-text("Simular pagamento"), button:has-text("simular")');
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();

    // Wait for state change to "aguardando suas fotos"
    await expect(customerPage.locator(".badge.awaiting_photos, .badge.in_queue")).toBeVisible({ timeout: 30_000 });

    await customerPage.reload();
    await customerPage.waitForLoadState("networkidle");

    // ─── STEP G: Upload images ───
    const uploadInput = customerPage.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    const imagesToUpload = Math.max(1, state.planAngles);
    const files: string[] = [];
    for (let i = 0; i < imagesToUpload; i++) {
      files.push(FIXTURE_IMAGE);
    }
    await uploadInput.setInputFiles(files);

    await expect(customerPage.locator(".file-list li.ok, .upload-area")).toBeVisible({ timeout: 30_000 });

    await customerPage.reload();
    await customerPage.waitForLoadState("networkidle");

    // ─── STEP H: Admin views order and uploads result ───
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adminPage = await adminContext.newPage();

    await authenticateWithSSR(adminPage, state.adminEmail, state.adminPassword);
    await expect(adminPage.locator("html")).toHaveAttribute("lang", "en");

    // Admin dashboard uses EN routes
    await adminPage.goto("/en/dashboard/orders");
    await expect(adminPage).toHaveURL(/\/en\/dashboard\/orders/);

    if (!orderId) throw new Error("PT Journey: orderId is undefined");
    const orderLink = adminPage.locator(`a[href*="${orderId}"], tr:has-text("${orderId.slice(0, 8)}") a`).first();
    await expect(orderLink).toBeVisible({ timeout: 15_000 });
    await orderLink.click();

    await expect(adminPage.locator("h1")).toContainText(/order details/i);

    // Upload result
    const resultUploadInput = adminPage.locator('input[type="file"][name="files"]').first();
    await expect(resultUploadInput).toBeAttached({ timeout: 10_000 });
    await resultUploadInput.setInputFiles(FIXTURE_IMAGE);

    const uploadResultBtn = adminPage.locator('button:has-text("Upload results"), button:has-text("upload")').first();
    await expect(uploadResultBtn).toBeVisible();
    await uploadResultBtn.click();

    await expect(adminPage.locator(".form-status.ok")).toBeVisible({ timeout: 30_000 });

    // Change status to completed if available
    const statusSelect = adminPage.locator('select[name="status"], select').first();
    if (await statusSelect.isVisible().catch(() => false)) {
      await statusSelect.selectOption("completed");
      const saveBtn = adminPage.locator('button:has-text("Save"), button:has-text("Change")').first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        await expect(adminPage.locator(".form-status.ok")).toBeVisible({ timeout: 10_000 });
      }
    }

    await adminContext.close();

    // ─── STEP I: Customer downloads result ───
    await customerPage.reload();
    await customerPage.waitForLoadState("networkidle");

    const downloadLink = customerPage.locator('a[download], a:has-text("Baixar"), a.btn-secondary:has-text("baixar")').first();
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    const href = await downloadLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href!.length).toBeGreaterThan(10);

    // ─── STEP J: Customer requests revision ───
    const revisionTextarea = customerPage.locator('textarea[name="notes"], textarea#revision-notes');
    if (await revisionTextarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await revisionTextarea.fill("Por favor, ajuste o contraste levemente.");
      const revisionBtn = customerPage.locator('button:has-text("Solicitar revisão"), button:has-text("revisão")').first();
      await revisionBtn.click();
      await expect(customerPage.locator("main")).toContainText(/revisão solicitada|revisão/i, { timeout: 15_000 });
    }

    await customerContext.close();
  });
});