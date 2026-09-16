import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";

test.describe("Authenticated Session — SSR Cookie Strategy", () => {
  let userId: string;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    const user = await createTestUser("ssr-auth", "user");
    userId = user.userId;
    email = user.email;
    password = user.password;
  });

  test.afterAll(async () => {
    if (userId) {
      await cleanupUserData(userId);
      await deleteTestUser(userId).catch(() => {});
    }
  });

  test("SSR cookies grant access to protected /en/account route", async ({ page }) => {
    // Authenticate using SSR-compatible cookies
    await authenticateWithSSR(page, email, password);

    // Navigate to protected route — should NOT redirect to login
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/account/, { timeout: 10_000 });

    // Verify authenticated content is visible (not login form)
    await expect(page.locator("h1")).toContainText(/my orders|meus pedidos/i);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
  });

  test("session persists after page reload", async ({ page }) => {
    await authenticateWithSSR(page, email, password);

    // First navigation
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/account/);

    // Reload — session must survive
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Should still be on account page, not redirected to login
    await expect(page).toHaveURL(/\/en\/account/, { timeout: 10_000 });
    await expect(page.locator("h1")).toContainText(/my orders|meus pedidos/i);
  });

  test("session works across different protected routes", async ({ page }) => {
    await authenticateWithSSR(page, email, password);

    // Visit account
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/account/);

    // Navigate to another protected route via link or direct URL
    await page.goto("/en/dashboard");
    // Non-admin users should be redirected away from dashboard by middleware
    // This proves the session IS recognized (middleware checked role, not auth absence)
    const url = page.url();
    // Either redirected to home (non-admin) or stayed on dashboard (admin)
    // Key point: NOT redirected to /login
    expect(url).not.toMatch(/\/login/);
  });
});