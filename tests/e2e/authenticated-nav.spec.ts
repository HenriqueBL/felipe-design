import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";
import { navigateToSingleItemCheckout } from "./helpers/checkout";

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

    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();

    if (isMobile) {
      // On mobile, open the drawer to verify auth state
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
      // Sign out is a button inside the drawer or header; check both
      const signOutBtn = page.getByRole("button", { name: /sign out/i });
      await expect(signOutBtn.first()).toBeVisible();
    } else {
      // Desktop: AuthNav renders <form class="inline"><button type="submit" class="linklike">
      await expect(desktopNav.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
      await expect(desktopNav.locator("form.inline button[type='submit']")).toBeVisible();
      await expect(desktopNav.getByRole("link", { name: /my orders/i })).toBeVisible();
    }
  });

  test("PT header shows Sair, not Entrar, when authenticated", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/pt");

    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();

    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link", { name: /^entrar$/i })).toHaveCount(0);
      const signOutBtn = page.getByRole("button", { name: /sair/i });
      await expect(signOutBtn.first()).toBeVisible();
    } else {
      // Desktop: AuthNav renders <form class="inline"><button type="submit" class="linklike">
      await expect(desktopNav.getByRole("link", { name: /^entrar$/i })).toHaveCount(0);
      await expect(desktopNav.locator("form.inline button[type='submit']")).toBeVisible();
      await expect(desktopNav.getByRole("link", { name: /meus pedidos/i })).toBeVisible();
    }
  });

  test("header keeps reflecting the session after page reload", async ({ page }) => {
    await authenticateWithSSR(page, email, password);
    await page.goto("/en/services");
    await page.reload();
    await page.waitForLoadState("networkidle");

    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();

    if (isMobile) {
      await mobileTrigger.click();
      const drawer = page.locator("#mobile-nav-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
      const signOutBtn = page.getByRole("button", { name: /sign out/i });
      await expect(signOutBtn.first()).toBeVisible();
    } else {
      // Desktop: AuthNav renders <form class="inline"><button type="submit" class="linklike">
      await expect(desktopNav.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);
      await expect(desktopNav.locator("form.inline button[type='submit']")).toBeVisible();
    }
  });

  test("authenticated checkout renders create-order step, not magic link form", async ({ page }) => {
    await authenticateWithSSR(page, email, password);

    // Use helper for single-item checkout fixture creation
    await navigateToSingleItemCheckout(page, "en");

    // Authenticated visitors must land directly on the order step.
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(
      page.locator("main").getByRole("button", { name: /create order/i }),
    ).toBeVisible();

    // Refresh must keep the authenticated behavior and the intent params.
    await page.reload();
    await expect(page).toHaveURL(/\/en\/checkout\?plan=/);
    await expect(page.locator('input[type="email"]')).not.toBeVisible();
    await expect(
      page.locator("main").getByRole("button", { name: /create order/i }),
    ).toBeVisible();
  });
});