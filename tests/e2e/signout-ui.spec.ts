import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";

/**
 * Regression: signing out must update the UI immediately, without a manual
 * refresh. Bug found during manual magic-link sign-off: the header kept
 * showing "Sign out" after clicking it; only a full F5 revealed the signed
 * out state. Root cause: a GET route handler redirect does not invalidate
 * the Next.js client Router Cache. The fix signs out via a Server Action
 * that revalidates the layout tree and redirects in the same round trip.
 */
test.describe("Sign out updates UI immediately (no manual refresh)", () => {
  let userId: string;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    const user = await createTestUser("signout", "user");
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

  test("EN: click Sign out — header flips to Sign in without page.reload()", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/en");

    const nav = page.locator("nav.site-nav");
    await expect(nav.getByRole("button", { name: /sign out/i })).toBeVisible();

    // Click sign out. NO page.reload() between click and assertions.
    await nav.getByRole("button", { name: /sign out/i }).click();

    await expect(page).toHaveURL(/\/en$/, { timeout: 10_000 });
    await expect(nav.getByRole("button", { name: /sign out/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("EN: after sign out, checkout shows the magic link form again (no reload)", async ({ page }) => {
    await authenticateWithSSR(page, email, password);

    await page.goto("/en/services");
    await page
      .locator('a[href*="checkout"], button:has-text("Choose")')
      .first()
      .click();
    await expect(page).toHaveURL(/\/en\/checkout\?/);

    // Authenticated: no email form yet.
    await expect(page.locator('input[type="email"]')).not.toBeVisible();

    // Sign out from the header, then re-enter checkout — no reload.
    await page.locator("nav.site-nav").getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/en$/, { timeout: 10_000 });

    await page.goto("/en/services");
    await page
      .locator('a[href*="checkout"], button:has-text("Choose")')
      .first()
      .click();
    await expect(page).toHaveURL(/\/en\/checkout\?/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("EN: signed-out state persists after an actual refresh", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/en");
    await page.locator("nav.site-nav").getByRole("button", { name: /sign out/i }).click();
    await expect(page.locator("nav.site-nav").getByRole("link", { name: /sign in/i })).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");

    const nav = page.locator("nav.site-nav");
    await expect(nav.getByRole("button", { name: /sign out/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("PT: Sair — header muda para Entrar sem F5", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/pt");

    const nav = page.locator("nav.site-nav");
    await expect(nav.getByRole("button", { name: /sair/i })).toBeVisible();

    await nav.getByRole("button", { name: /sair/i }).click();

    await expect(page).toHaveURL(/\/pt$/, { timeout: 10_000 });
    await expect(nav.getByRole("button", { name: /sair/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /entrar/i })).toBeVisible();
  });
});
