import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";
import { navigateToSingleItemCheckout } from "./helpers/checkout";

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

  async function clickSignOut(page: import("@playwright/test").Page) {
    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      // Mobile drawer uses AuthNav or direct button; try both patterns
      const drawerSignOut = drawer.locator("form.inline button[type='submit'], button:has-text('Sign out'), button:has-text('Sair')");
      await drawerSignOut.first().click();
    } else {
      // Desktop: AuthNav renders <form class="inline"><button type="submit" class="linklike">
      await desktopNav.locator("form.inline button[type='submit']").click();
    }
  }

  async function assertSignedOutEN(page: import("@playwright/test").Page) {
    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      // After sign-out, drawer should show Sign In link, not Sign Out form
      await expect(drawer.locator("form.inline button[type='submit']")).toHaveCount(0);
      await expect(drawer.getByRole("link", { name: /sign in/i })).toBeVisible();
    } else {
      // Desktop: AuthNav renders <a> for login when signed out, no form
      await expect(desktopNav.locator("form.inline button[type='submit']")).toHaveCount(0);
      await expect(desktopNav.getByRole("link", { name: /sign in/i })).toBeVisible();
    }
  }

  async function assertSignedOutPT(page: import("@playwright/test").Page) {
    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.locator("form.inline button[type='submit']")).toHaveCount(0);
      await expect(drawer.getByRole("link", { name: /entrar/i })).toBeVisible();
    } else {
      await expect(desktopNav.locator("form.inline button[type='submit']")).toHaveCount(0);
      await expect(desktopNav.getByRole("link", { name: /entrar/i })).toBeVisible();
    }
  }

  test("EN: click Sign out — header flips to Sign in without page.reload()", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en");

    // Verify signed-in state
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: /sign out/i })).toBeVisible();
      // Close drawer before sign out
      await drawer.locator(".mobile-nav-close").click();
    } else {
      const nav = page.locator("nav.site-nav");
      // Desktop: AuthNav renders <form class="inline"><button type="submit" class="linklike">
      await expect(nav.locator("form.inline button[type='submit']")).toBeVisible();
    }

    // Click sign out. NO page.reload() between click and assertions.
    await clickSignOut(page);

    await expect(page).toHaveURL(/\/en$/, { timeout: 10_000 });
    await assertSignedOutEN(page);
  });

  test("EN: after sign out, checkout shows the magic link form again (no reload)", async ({ page }) => {
    await authenticateWithSSR(page, email, password);

    // Use single-item checkout (not cart) because only single-item renders
    // input[type="email"] for unauthenticated users; cart checkout renders a Link.
    await navigateToSingleItemCheckout(page, "en");

    // Authenticated: no email form yet.
    await expect(page.locator('input[type="email"]')).not.toBeVisible();

    // Capture checkout URL for re-navigation after sign-out
    const checkoutUrl = page.url();

    // Sign out from the header, then re-enter checkout — no reload.
    await clickSignOut(page);
    await expect(page).toHaveURL(/\/en$/, { timeout: 10_000 });

    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto(checkoutUrl);
    await expect(page).toHaveURL(/\/en\/checkout\?plan=/);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("EN: signed-out state persists after an actual refresh", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en");
    await clickSignOut(page);
    await assertSignedOutEN(page);

    await page.reload();
    await page.waitForLoadState("networkidle");

    await assertSignedOutEN(page);
  });

  test("PT: Sair — header muda para Entrar sem F5", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt");

    // Verify signed-in state
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("button", { name: /sair/i })).toBeVisible();
      await drawer.locator(".mobile-nav-close").click();
    } else {
      const nav = page.locator("nav.site-nav");
      // Desktop: AuthNav renders <form class="inline"><button type="submit" class="linklike">
      await expect(nav.locator("form.inline button[type='submit']")).toBeVisible();
    }

    await clickSignOut(page);

    await expect(page).toHaveURL(/\/pt$/, { timeout: 10_000 });
    await assertSignedOutPT(page);
  });
});