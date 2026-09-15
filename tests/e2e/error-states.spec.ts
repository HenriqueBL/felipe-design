import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";

// Create a small invalid file (text file pretending to be image)
const INVALID_FILE_CONTENT = Buffer.from("This is not an image", "utf-8");
const INVALID_FILE_PATH = path.resolve(__dirname, "fixtures/invalid.txt");

test.describe("Error States & Edge Cases E2E", () => {
  let customer: { userId: string; email: string; password: string };
  let orderId: string;

  test.beforeAll(async () => {
    customer = await createTestUser("err-cust", "user");
    await getOrCreateTestPlan();

    // Create a valid order for revision tests
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await authenticateWithSSR(page, customer.email, customer.password);
    await page.goto("/en/services");
    const chooseBtn = page.locator('a[href*="checkout"], button:has-text("Choose")').first();
    await chooseBtn.click();
    await page.waitForURL(/\/en\/checkout/, { timeout: 10000 });

    const createBtn = page.locator('button:has-text("Create order"), button[type="submit"]').first();
    await createBtn.click();
    await page.waitForURL(/\/en\/account\/orders\//, { timeout: 15000 });
    orderId = page.url().match(/orders\/([0-9a-f-]+)/)?.[1] ?? "";

    await context.close();
    await browser.close();

    if (!orderId) throw new Error("Failed to create fixture order for error tests");
  });

  test.afterAll(async () => {
    if (customer?.userId) {
      await cleanupUserData(customer.userId);
      await deleteTestUser(customer.userId).catch(() => {});
    }
  });

  test("Non-existent order shows appropriate feedback (not stack trace)", async ({ page }) => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000";
    await authenticateWithSSR(page, customer.email, customer.password);

    await page.goto(`/en/account/orders/${fakeUuid}`);
    await page.waitForLoadState("networkidle");

    // Should NOT show raw Supabase errors or stack traces
    const content = await page.locator("body").textContent();
    expect(content).not.toMatch(/stack trace|SyntaxError|PostgrestError|supabase-js/i);

    // Should show user-friendly message or redirect
    const isHandled =
      /not found|doesn't exist|invalid|404/i.test(content ?? "") ||
      !page.url().includes(fakeUuid);
    expect(isHandled).toBeTruthy();
  });

  test("Invalid plan ID in checkout prevents order creation", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticateWithSSR(page, customer.email, customer.password);

    // Navigate to checkout with non-existent plan
    await page.goto("/en/checkout?plan=invalid-plan-id&qty=1&currency=USD");
    await page.waitForLoadState("networkidle");

    // Either redirected away, shown error, or submit button disabled/missing
    const url = page.url();
    const content = await page.locator("body").textContent();

    const isBlocked =
      !url.includes("checkout") ||
      /invalid|not found|select a plan/i.test(content ?? "") ||
      !(await page.locator('button:has-text("Create order")').isVisible().catch(() => false));

    expect(isBlocked).toBeTruthy();
    await context.close();
  });

  test("Invalid file upload shows validation feedback", async ({ browser }) => {
    // Write invalid file to disk for this test
    const fs = await import("node:fs");
    fs.writeFileSync(INVALID_FILE_PATH, INVALID_FILE_CONTENT);

    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticateWithSSR(page, customer.email, customer.password);

    await page.goto(`/en/account/orders/${orderId}`);
    await page.waitForLoadState("networkidle");

    // Only proceed if upload area is visible (order might need payment first)
    const uploadInput = page.locator('input[type="file"]').first();
    if (await uploadInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await uploadInput.setInputFiles(INVALID_FILE_PATH);

      // Wait for error feedback
      const errorMsg = page.locator('.error, .form-status.error, [role="alert"]');
      await expect(errorMsg).toBeVisible({ timeout: 10000 });

      const errorText = await errorMsg.textContent();
      expect(errorText).toMatch(/invalid|format|type|jpg|png|webp/i);
    }

    // Cleanup temp file
    fs.unlinkSync(INVALID_FILE_PATH);
    await context.close();
  });

  test("Second revision request is blocked when only one is allowed", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await authenticateWithSSR(page, customer.email, customer.password);

    await page.goto(`/en/account/orders/${orderId}`);
    await page.waitForLoadState("networkidle");

    // Check if revision form exists
    const revisionTextarea = page.locator('textarea[name="notes"], textarea#revision-notes');
    if (await revisionTextarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Submit first revision
      await revisionTextarea.fill("First revision request");
      const revisionBtn = page.locator('button:has-text("Request revision"), button:has-text("revision")').first();
      await revisionBtn.click();

      // Wait for success or state change
      await page.waitForTimeout(2000);
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Try second revision - should be blocked
      const secondTextarea = page.locator('textarea[name="notes"], textarea#revision-notes');
      const secondBtn = page.locator('button:has-text("Request revision"), button:has-text("revision")').first();

      const isBlocked =
        !(await secondTextarea.isVisible().catch(() => false)) ||
        !(await secondBtn.isEnabled().catch(() => false)) ||
        (await secondBtn.getAttribute("disabled")) !== null;

      // If form still visible, submitting should fail gracefully
      if (!isBlocked && await secondTextarea.isVisible()) {
        await secondTextarea.fill("Second revision attempt");
        await secondBtn.click();

        // Should show limit reached message or fail silently
        const content = await page.locator("main").textContent();
        const hasLimitMessage = /limit|already|one revision|exceeded/i.test(content ?? "");
        // Either UI blocks it or backend rejects it with friendly message
        expect(hasLimitMessage || isBlocked).toBeTruthy();
      }
    }

    await context.close();
  });

  test("Unauthenticated server action returns friendly error (no stack trace)", async ({ page }) => {
    // Don't authenticate - try accessing protected account page directly
    await page.goto("/en/account/orders/" + orderId);
    await page.waitForLoadState("networkidle");

    // Should redirect to login or show access denied
    const url = page.url();
    // innerText (not textContent): the Next dev-mode RSC payload inside
    // <script> tags contains internal module paths (e.g. src/lib/supabase),
    // which are not user-visible error output.
    const content = await page.locator("body").innerText();

    // Must NOT expose internal errors
    expect(content).not.toMatch(/stack trace|PostgrestError|RLS|supabase/i);

    // Should be redirected or shown auth prompt
    const isProtected =
      /login|sign.?in|entrar/i.test(url) ||
      /sign.?in|login|acesso/i.test(content ?? "");
    expect(isProtected).toBeTruthy();
  });
});