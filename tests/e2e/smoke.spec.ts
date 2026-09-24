import { test, expect } from "@playwright/test";

test.describe("E2E Infrastructure Smoke", () => {
  test("homepage loads in EN with correct locale and navigation", async ({ page }) => {
    await page.goto("/en");
    await expect(page).toHaveTitle(/Felipe Design/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // Desktop: nav.site-nav is visible; Mobile: hamburger trigger is visible
    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await expect(mobileTrigger).toBeVisible();
    } else {
      await expect(desktopNav.getByRole("link", { name: /services/i })).toBeVisible();
      await expect(desktopNav.getByRole("link", { name: /sign in/i })).toBeVisible();
    }
  });

  test("homepage loads in PT with correct locale and navigation", async ({ page }) => {
    await page.goto("/pt");
    await expect(page).toHaveTitle(/Felipe Design/);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");

    // Desktop: nav.site-nav is visible; Mobile: hamburger trigger is visible
    const desktopNav = page.locator("nav.site-nav");
    const mobileTrigger = page.locator(".mobile-nav-trigger");
    const isMobile = (await mobileTrigger.isVisible()).valueOf();
    if (isMobile) {
      await expect(mobileTrigger).toBeVisible();
    } else {
      await expect(desktopNav.getByRole("link", { name: /serviços/i })).toBeVisible();
      await expect(desktopNav.getByRole("link", { name: /entrar/i })).toBeVisible();
    }
  });

  test("root redirects to default locale (EN)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en/);
  });

  test("services page renders plans from backend in EN", async ({ page }) => {
    await page.goto("/en/services");
    await expect(page.locator("h1")).toContainText(/services/i);

    // At least one plan card should be visible with price
    // Semantic selector: article with data-plan-id attribute
    const planCards = page.locator("article[data-plan-id]");
    await expect(planCards.first()).toBeVisible({ timeout: 10_000 });
  });

  test("services page renders plans from backend in PT via canonical route", async ({ page }) => {
    await page.goto("/pt/servicos");
    await expect(page.locator("h1")).toContainText(/serviços/i);

    // At least one plan card should be visible
    // Semantic selector: article with data-plan-id attribute
    const planCards = page.locator("article[data-plan-id]");
    await expect(planCards.first()).toBeVisible({ timeout: 10_000 });
  });

  test("unauthenticated user is redirected from account to login", async ({ page }) => {
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/login/);
    await expect(page.locator("h1")).toContainText(/sign in/i);
  });

  test("unauthenticated user is redirected from PT conta to login", async ({ page }) => {
    await page.goto("/pt/conta");
    await expect(page).toHaveURL(/\/pt\/login/);
    await expect(page.locator("h1")).toContainText(/entrar/i);
  });

  test("checkout without valid params shows invalid selection message", async ({ page }) => {
    await page.goto("/en/checkout");
    await expect(page.locator("main")).toContainText(/invalid|choose|back to services/i);
  });

  test("no critical console errors on homepage", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/en");
    await page.waitForLoadState("networkidle");

    // Filter out known non-critical warnings
    const criticalErrors = errors.filter(
      (e) => !e.includes("hydration") && !e.includes("Hydration"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});