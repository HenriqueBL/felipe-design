import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";

test.describe("Authorization & Access Control E2E", () => {
  let customerA: { userId: string; email: string; password: string };
  let customerB: { userId: string; email: string; password: string };
  let adminUser: { userId: string; email: string; password: string };
  let orderIdB: string;

  test.beforeAll(async () => {
    customerA = await createTestUser("auth-a", "user");
    customerB = await createTestUser("auth-b", "user");
    adminUser = await createTestUser("auth-admin", "admin");

    // Ensure at least one active plan exists for checkout flows in other specs
    await getOrCreateTestPlan();

    // We need to create an order for B programmatically or via UI.
    // For isolation and speed, we'll do it via UI in a setup step or use the journey pattern.
    // To keep this spec focused on auth checks, let's create B's order quickly via UI.
    // Alternatively, we could use a helper, but UI ensures the order is fully valid.
    // Given time/scope, let's assume we can create it here or skip if too complex.
    // Actually, creating via UI in beforeAll is heavy. Let's use a simpler approach:
    // Just test access to /en/account/orders/<fake-uuid> for cross-user if we can't easily create one.
    // BUT, the prompt asks for "Client A tries to open Client B's order".
    // So we MUST create B's order.

    // Create B's order using the same validated journey pattern
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Authenticate FIRST on a neutral page, then navigate organically to checkout.
    // This ensures all subsequent Server Component renders already carry the session.
    await authenticateWithSSR(page, customerB.email, customerB.password);

    // Verify session is active before proceeding
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/account/, { timeout: 10000 });

    // Now navigate to services and choose plan — session persists across navigations
    await page.goto("/en/services");
    await expect(page.locator("h1")).toContainText(/services/i, { timeout: 10000 });

    const chooseBtn = page.locator('a[href*="checkout"], button:has-text("Choose"), a:has-text("Choose"), a:has-text("Select")').first();
    await expect(chooseBtn).toBeVisible({ timeout: 10000 });
    await chooseBtn.click();

    // Checkout should now render in authenticated state directly
    await expect(page).toHaveURL(/\/en\/checkout/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");

    const createBtn = page.locator('button:has-text("Create order"), button[type="submit"]').first();
    await expect(createBtn).toBeVisible({ timeout: 15000 });
    await createBtn.click();

    await page.waitForURL(/\/en\/account\/orders\//, { timeout: 15000 });
    orderIdB = page.url().match(/orders\/([0-9a-f-]+)/)?.[1] ?? "";

    await context.close();
    await browser.close();

    if (!orderIdB) throw new Error("Failed to create fixture order for Customer B");
  });

  test.afterAll(async () => {
    if (customerA?.userId) {
      await cleanupUserData(customerA.userId);
      await deleteTestUser(customerA.userId).catch(() => {});
    }
    if (customerB?.userId) {
      await cleanupUserData(customerB.userId);
      await deleteTestUser(customerB.userId).catch(() => {});
    }
    if (adminUser?.userId) {
      await cleanupUserData(adminUser.userId);
      await deleteTestUser(adminUser.userId).catch(() => {});
    }
  });

  test("Unauthenticated user is redirected from protected routes", async ({ page }) => {
    // EN account
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/login|\/en\/sign-in/i, { timeout: 10000 });

    // PT conta
    await page.goto("/pt/conta");
    await expect(page).toHaveURL(/\/pt\/login|\/pt\/entrar/i, { timeout: 10000 });

    // Admin route (should also redirect to login, not show dashboard)
    await page.goto("/en/dashboard");
    await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.locator("h1")).not.toContainText(/dashboard/i);
  });

  test("Normal user cannot access admin routes", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await authenticateWithSSR(page, customerA.email, customerA.password);

    // Try accessing admin dashboard
    await page.goto("/en/dashboard");
    // Should be redirected away or shown forbidden/not-found
    // Common patterns: redirect to home, or stay on page with error message
    const url = page.url();
    const content = await page.locator("body").textContent();

    const isAdminBlocked =
      !url.includes("/dashboard") ||
      /forbidden|access denied|not found|403|404/i.test(content ?? "");

    expect(isAdminBlocked).toBeTruthy();

    // Try accessing specific admin order detail
    await page.goto(`/en/dashboard/orders/${orderIdB}`);
    const adminOrderUrl = page.url();
    const adminOrderContent = await page.locator("body").textContent();

    const isAdminOrderBlocked =
      !adminOrderUrl.includes("/dashboard/orders/") ||
      /forbidden|access denied|not found|403|404/i.test(adminOrderContent ?? "");

    expect(isAdminOrderBlocked).toBeTruthy();

    await context.close();
  });

  test("Client A cannot access Client B's order (cross-user isolation)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await authenticateWithSSR(page, customerA.email, customerA.password);

    // Direct navigation to B's order URL
    await page.goto(`/en/account/orders/${orderIdB}`);

    // Should NOT show B's order details
    // Expected: redirect to account list, or not-found/denied message
    const currentUrl = page.url();
    const mainContent = await page.locator("main").textContent();

    // Verify no leakage of B's data
    expect(mainContent).not.toContain(customerB.email);
    expect(mainContent).not.toContain(orderIdB.slice(0, 8)); // Partial ID check

    // Verify access was denied (redirected or error shown)
    const isAccessDenied =
      !currentUrl.includes(orderIdB) ||
      /not found|denied|forbidden|doesn't belong/i.test(mainContent ?? "");

    expect(isAccessDenied).toBeTruthy();

    await context.close();
  });

  test("Admin CAN access any order (positive control)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await authenticateWithSSR(page, adminUser.email, adminUser.password);

    // Admin should be able to see B's order
    await page.goto(`/en/dashboard/orders/${orderIdB}`);

    // Wait for page load
    await page.waitForLoadState("networkidle");

    // Should show order details (not blocked)
    await expect(page).toHaveURL(new RegExp(orderIdB), { timeout: 10000 });
    await expect(page.locator("main, .order-detail")).toBeVisible();

    // Should contain order info (proving admin access works)
    const content = await page.locator("main, .order-detail").textContent();
    expect(content?.toLowerCase()).toMatch(/order|pedido|status/i);

    await context.close();
  });
});