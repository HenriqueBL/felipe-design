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
}

test.describe("Complete Customer Journey — EN", () => {
  let state: TestState;

  test.beforeAll(async () => {
    // Create customer and admin users
    const customer = await createTestUser("cust-en", "user");
    const admin = await createTestUser("admin-en", "admin");
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
    };
  });

  test.afterAll(async () => {
    // Cleanup all test data
    if (state?.customerUserId) {
      await cleanupUserData(state.customerUserId);
      await deleteTestUser(state.customerUserId).catch(() => {});
    }
    if (state?.adminUserId) {
      await cleanupUserData(state.adminUserId);
      await deleteTestUser(state.adminUserId).catch(() => {});
    }
  });

  test("full EN journey: visitor → services → magic link → checkout → upload → payment → admin result → download → revision", async ({ browser }) => {
    // ─── STEP A: Visitor lands on homepage ───
    const customerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const customerPage = await customerContext.newPage();

    await customerPage.goto("/en");
    await expect(customerPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(customerPage).toHaveTitle(/Felipe Design/);

    // ─── STEP B: Navigate to services ───
    await customerPage.click('a[href*="services"], nav >> text=/services/i');
    await expect(customerPage).toHaveURL(/\/en\/services/);
    await expect(customerPage.locator("h1")).toContainText(/services/i);

    // Verify at least one plan is rendered with real backend data
    const planCard = customerPage.locator(".plan-card, [data-plan]").first();
    await expect(planCard).toBeVisible({ timeout: 10_000 });

    // ─── STEP C: Choose a plan → navigate to checkout ───
    // Click the first "Choose plan" button/link
    const chooseBtn = customerPage.locator('a[href*="checkout"], button:has-text("Choose"), a:has-text("Choose")').first();
    await chooseBtn.click();
    await expect(customerPage).toHaveURL(/\/en\/checkout/);

    // Verify checkout shows order summary
    await expect(customerPage.locator("main")).toContainText(/confirm your order|order summary/i);

    // ─── STEP D: Authentication (SSR cookies for journey stability) ───
    // Capture the current checkout URL with intent params before authenticating
    const checkoutUrlWithIntent = customerPage.url();
    expect(checkoutUrlWithIntent).toMatch(/plan=/);

    // Authenticate via @supabase/ssr cookie injection (bypasses Magic Link UI for stable journey test)
    // A separate dedicated test validates the real Magic Link/callback flow
    await authenticateWithSSR(customerPage, state.customerEmail, state.customerPassword);

    // Navigate back to checkout with original intent params preserved
    await customerPage.goto(checkoutUrlWithIntent);
    await expect(customerPage).toHaveURL(/\/en\/checkout/, { timeout: 15_000 });

    // Verify the checkout still has the plan/quantity params (intent preserved through auth)
    const currentUrl = customerPage.url();
    expect(currentUrl).toMatch(/plan=/);

    // ─── STEP E: Create order ───
    // Now authenticated, should see "Create order" button instead of login form
    // Scope to main: the header now renders a Sign out <button type="submit">.
    const createBtn = customerPage.locator("main").getByRole("button", { name: /create order/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // Should redirect to account order detail page
    await expect(customerPage).toHaveURL(/\/en\/account\/orders\//, { timeout: 15_000 });

    // Extract orderId from URL
    const orderUrl = customerPage.url();
    const orderIdMatch = orderUrl.match(/orders\/([0-9a-f-]+)/);
    expect(orderIdMatch).toBeTruthy();
    const orderId = orderIdMatch![1];

    // Verify order detail page content
    await expect(customerPage.locator("main")).toContainText(/order/i);
    await expect(customerPage.locator("main")).toContainText(/awaiting payment/i);

    // ─── STEP F: Mock Payment (must happen BEFORE upload per business rules) ───
    // Find and click the simulate payment button
    const payBtn = customerPage.locator('button:has-text("Simulate payment"), button:has-text("simulate")');
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();

    // Wait for state change: badge should transition from "awaiting payment" to "awaiting your photos"
    // The "Confirming..." text is transient and disappears after server action completes + revalidate
    await expect(customerPage.locator(".badge.awaiting_photos, .badge.in_queue")).toBeVisible({ timeout: 30_000 });

    // Refresh to verify state persistence and reveal upload area
    await customerPage.reload();
    await customerPage.waitForLoadState("networkidle");

    // Order should no longer show "awaiting payment" badge
    await expect(customerPage.locator(".badge.awaiting_payment")).not.toBeVisible({ timeout: 10_000 });

    // ─── STEP G: Upload images (only available after payment) ───
    // The file input is hidden but present in DOM; Playwright can set files on it directly.
    const uploadInput = customerPage.locator('input[type="file"]').first();
    await expect(uploadInput).toBeAttached({ timeout: 10_000 });

    // Upload the required number of images (planAngles * knife quantity)
    const imagesToUpload = Math.max(1, state.planAngles);
    const files: string[] = [];
    for (let i = 0; i < imagesToUpload; i++) {
      files.push(FIXTURE_IMAGE);
    }
    await uploadInput.setInputFiles(files);

    // Functional state: persisted images appear as .source-photo-item entries
    // (completed jobs migrate from job-* to the persisted image list).
    await expect
      .poll(async () => customerPage.locator(".source-photo-item").count(), { timeout: 60_000 })
      .toBeGreaterThanOrEqual(imagesToUpload);
    // Counter per knife reflects the uploads and Finish becomes available.
    const knifeHeading = customerPage.locator(".source-photo-knife h4").first();
    await expect(knifeHeading).toContainText(new RegExp(`${imagesToUpload} / \\d+`), { timeout: 15_000 });
    await expect(customerPage.locator('button:has-text("Finish photo submission")')).toBeEnabled();

    // Refresh to see updated state
    await customerPage.reload();
    await customerPage.waitForLoadState("networkidle");

    // ─── STEP H: Admin views order and uploads result ───
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adminPage = await adminContext.newPage();

    // Authenticate as admin via SSR cookies (same strategy as customer)
    await authenticateWithSSR(adminPage, state.adminEmail, state.adminPassword);
    await expect(adminPage.locator("html")).toHaveAttribute("lang", "en");

    // Navigate to admin dashboard orders
    await adminPage.goto("/en/dashboard/orders");
    await expect(adminPage).toHaveURL(/\/en\/dashboard\/orders/);

    // Find and click on the customer's order
    // The order should be visible in the admin list
    if (!orderId) throw new Error("EN Journey: orderId is undefined");
    const orderLink = adminPage.locator(`a[href*="${orderId}"], tr:has-text("${orderId.slice(0, 8)}") a`).first();
    await expect(orderLink).toBeVisible({ timeout: 15_000 });
    await orderLink.click();

    // Verify admin can see order details
    await expect(adminPage.locator("h1")).toContainText(/order details/i);

    // Upload result file as admin
    const resultUploadInput = adminPage.locator('input[type="file"][name="files"]').first();
    await expect(resultUploadInput).toBeAttached({ timeout: 10_000 });
    await resultUploadInput.setInputFiles(FIXTURE_IMAGE);

    // Click upload results button
    const uploadResultBtn = adminPage.locator('button:has-text("Upload results"), button:has-text("upload")').first();
    await expect(uploadResultBtn).toBeVisible();
    await uploadResultBtn.click();

    // Wait for success feedback in the result upload form panel specifically
    await expect(adminPage.locator(".form-status.ok")).toBeVisible({ timeout: 30_000 });

    // Change order status to completed if not automatic
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

    // Result download link should now be visible
    const downloadLink = customerPage.locator('a[download], a:has-text("Download"), a.btn-secondary:has-text("download")').first();
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });

    // Verify download works (check href is a signed URL)
    const href = await downloadLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href!.length).toBeGreaterThan(10);

    // ─── STEP J: Customer requests revision ───
    // Revision form should appear after result delivery
    const revisionTextarea = customerPage.locator('textarea[name="notes"], textarea#revision-notes');
    if (await revisionTextarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await revisionTextarea.fill("Please adjust the contrast slightly.");
      const revisionBtn = customerPage.locator('button:has-text("Request revision"), button:has-text("revision")').first();
      await revisionBtn.click();

      // Wait for revision confirmation
      await expect(customerPage.locator("main")).toContainText(/revision requested|revision/i, { timeout: 15_000 });
    }

    // ─── CLEANUP ───
    await customerContext.close();
  });
});