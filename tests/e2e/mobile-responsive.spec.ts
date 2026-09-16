import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.describe("Mobile Responsiveness E2E", () => {
  let customer: { userId: string; email: string; password: string };
  let admin: { userId: string; email: string; password: string };
  let orderId: string;

  test.beforeAll(async () => {
    customer = await createTestUser("mob-cust", "user");
    admin = await createTestUser("mob-admin", "admin");
    await getOrCreateTestPlan();

    // Create an order for mobile testing via desktop context first
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await authenticateWithSSR(page, customer.email, customer.password);
    await page.goto("/en/services");
    const chooseBtn = page.locator('a[href*="checkout"], button:has-text("Choose")').first();
    await chooseBtn.click();
    await page.waitForURL(/\/en\/checkout/, { timeout: 10000 });

    // Scope to main: the header now renders a Sign out <button type="submit">.
    const createBtn = page.locator("main").getByRole("button", { name: /create order/i });
    await createBtn.click();
    await page.waitForURL(/\/en\/account\/orders\//, { timeout: 15000 });
    orderId = page.url().match(/orders\/([0-9a-f-]+)/)?.[1] ?? "";

    await context.close();
    await browser.close();

    if (!orderId) throw new Error("Failed to create fixture order for mobile tests");
  });

  test.afterAll(async () => {
    if (customer?.userId) {
      await cleanupUserData(customer.userId);
      await deleteTestUser(customer.userId).catch(() => {});
    }
    if (admin?.userId) {
      await cleanupUserData(admin.userId);
      await deleteTestUser(admin.userId).catch(() => {});
    }
  });

  /**
   * Helper to check for horizontal overflow on mobile viewport.
   * Returns true if page has no horizontal scroll.
   */
  async function assertNoHorizontalOverflow(page: import("@playwright/test").Page): Promise<void> {
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBeFalsy();
  }

  test("EN Services page is responsive on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await page.goto("/en/services");
    await page.waitForLoadState("networkidle");

    // Verify content loads
    await expect(page.locator("h1")).toContainText(/services/i);

    // Check no horizontal overflow
    await assertNoHorizontalOverflow(page);

    // Verify plan cards are accessible (not cut off)
    const planCards = page.locator(".plan-card, [data-plan]");
    if (await planCards.count() > 0) {
      const firstCard = planCards.first();
      await expect(firstCard).toBeVisible();

      // Card should be within viewport bounds
      const box = await firstCard.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 10); // small tolerance
    }

    // Header/menu should be usable
    const header = page.locator("header, nav").first();
    await expect(header).toBeVisible();

    await context.close();
  });

  test("EN Checkout page is responsive on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await authenticateWithSSR(page, customer.email, customer.password);
    await page.goto("/en/checkout?plan=test&qty=1&currency=USD");
    await page.waitForLoadState("networkidle");

    // Page should load (even if plan invalid, structure renders)
    await expect(page.locator("body")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Form inputs should be accessible and not overflowing
    const inputs = page.locator("input, select, textarea");
    const count = await inputs.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      const input = inputs.nth(i);
      if (await input.isVisible().catch(() => false)) {
        const box = await input.boundingBox();
        if (box) {
          // Input should start within viewport
          expect(box.x).toBeGreaterThanOrEqual(-5);
          // Input should not extend far beyond viewport
          expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 20);
        }
      }
    }

    await context.close();
  });

  test("EN Account & Order Detail is responsive on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await authenticateWithSSR(page, customer.email, customer.password);

    // Test account list
    await page.goto("/en/account");
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page);

    // Test order detail
    await page.goto(`/en/account/orders/${orderId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("main")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Upload area (if visible) should be usable
    const uploadInput = page.locator('input[type="file"]');
    if (await uploadInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await uploadInput.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(50); // Should have reasonable tap target
    }

    // Buttons should be tappable (min height ~44px recommended)
    const buttons = page.locator("button, a.btn, .btn");
    const btnCount = await buttons.count();
    for (let i = 0; i < Math.min(btnCount, 5); i++) {
      const btn = buttons.nth(i);
      if (await btn.isVisible().catch(() => false)) {
        const box = await btn.boundingBox();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(30); // Minimum touch target
        }
      }
    }

    await context.close();
  });

  test("PT Serviços page is responsive on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await page.goto("/pt/servicos");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText(/serviços/i);
    await assertNoHorizontalOverflow(page);

    // Verify BRL prices render without breaking layout
    const priceElements = page.locator("text=/R\\$/");
    if (await priceElements.count() > 0) {
      const firstPrice = priceElements.first();
      const box = await firstPrice.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width + 10);
    }

    await context.close();
  });

  test("PT Finalizar (checkout) page is responsive on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await authenticateWithSSR(page, customer.email, customer.password);
    await page.goto("/pt/finalizar?plan=test&qty=1&currency=BRL");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Canonical route check
    expect(page.url()).toContain("/pt/finalizar");
    expect(page.url()).not.toContain("/pt/checkout");

    await context.close();
  });

  test("PT Conta page is responsive on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await authenticateWithSSR(page, customer.email, customer.password);
    await page.goto("/pt/conta");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("main")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Verify locale preserved
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");

    await context.close();
  });

  test("Admin Dashboard is usable on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await authenticateWithSSR(page, admin.email, admin.password);
    await page.goto("/en/dashboard");
    await page.waitForLoadState("networkidle");

    // Dashboard should load (even if tables need horizontal scroll internally)
    await expect(page.locator("body")).toBeVisible();

    // Main container should not cause full-page horizontal overflow
    // (internal table scroll is acceptable, but page-level overflow is not)
    await assertNoHorizontalOverflow(page);

    // Navigation/header should be accessible
    const nav = page.locator("header, nav, .sidebar-toggle, [aria-label*='menu']").first();
    await expect(nav).toBeVisible();

    await context.close();
  });

  test("Admin Order Detail is usable on mobile", async ({ browser }) => {
    const context = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    const page = await context.newPage();

    await authenticateWithSSR(page, admin.email, admin.password);
    await page.goto(`/en/dashboard/orders/${orderId}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("main")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    // Action buttons (upload result, change status) should be tappable
    const actionBtns = page.locator('button, input[type="file"]');
    const count = await actionBtns.count();
    let foundActionable = false;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const el = actionBtns.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const box = await el.boundingBox();
        if (box && box.height >= 30) {
          foundActionable = true;
          break;
        }
      }
    }
    // At least one interactive element should have adequate touch target
    expect(foundActionable).toBeTruthy();

    await context.close();
  });
});