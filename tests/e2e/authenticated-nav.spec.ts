import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";

/**
 * Regression: the site header must reflect the real Supabase session.
 * Bug found during manual magic-link sign-off: after a successful
 * /auth/callback the header kept showing "Sign in", so the user did not
 * realize they were authenticated and retried the magic link (feeding the
 * email rate limit). The source of truth is the server session — no
 * parallel client-side auth state is allowed.
 */
test.describe("Authenticated navigation reflects session", () => {
  let userId: string;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    const user = await createTestUser("nav-auth", "user");
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

  test("EN header shows sign-out, not sign-in, when authenticated", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/en");

    const nav = page.locator("nav.site-nav");
    await expect(nav.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: /sign out/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /my orders/i })).toBeVisible();
  });

  test("PT header shows Sair, not Entrar, when authenticated", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/pt");

    const nav = page.locator("nav.site-nav");
    await expect(nav.getByRole("link", { name: /^entrar$/i })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: /sair/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /meus pedidos/i })).toBeVisible();
  });

  test("header keeps reflecting the session after page reload", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/en/services");
    await page.reload();
    await page.waitForLoadState("networkidle");

    const nav = page.locator("nav.site-nav");
    await expect(nav.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("authenticated checkout renders create-order step, not magic link form", async ({ page }) => {
    await authenticateWithSSR(page, email, password);

    await page.goto("/en/services");
    const chooseBtn = page
      .locator('a[href*="checkout"], button:has-text("Choose")')
      .first();
    await chooseBtn.click();
    await expect(page).toHaveURL(/\/en\/checkout\?/);

    // Authenticated visitors must land directly on the order step.
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page.locator('button:has-text("Create order")')).toBeVisible();

    // Refresh must keep the authenticated behavior and the intent params.
    await page.reload();
    await expect(page).toHaveURL(/\/en\/checkout\?/);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(page.locator('button:has-text("Create order")')).toBeVisible();
  });
});