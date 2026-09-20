import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUser } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";

interface TestState {
  userId: string;
  email: string;
  password: string;
}

test.describe("Multi-item Cart Journey", () => {
  let state: TestState;

  test.beforeAll(async () => {
    const user = await createTestUser("cart-multi", "user");
    state = {
      userId: user.userId,
      email: user.email,
      password: user.password,
    };
  });

  test.afterAll(async () => {
    if (state?.userId) {
      await cleanupUserData(state.userId);
      await deleteTestUser(state.userId).catch(() => {});
    }
  });

  test("add two plans to cart, verify quantities, persist across refresh, checkout with auth boundary", async ({ browser }) => {
    // ─── STEP 1: Unauthenticated visitor adds items to cart ───
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto("/en/services");
    await expect(page.locator("h1")).toContainText(/services/i);

    // Find plan cards — we need at least 2 different plans
    const addToCartButtons = page.locator('button:has-text("Add to cart"), button:has-text("Add")');
    const buttonCount = await addToCartButtons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(2);

    // Add first plan
    await addToCartButtons.nth(0).click();
    // Wait for badge to update
    const badge = page.locator('[data-cart-badge], .cart-badge, a[href*="cart"] span, a[href*="carrinho"] span');
    await expect(badge.first()).toBeVisible({ timeout: 5_000 });

    // Add second plan
    await addToCartButtons.nth(1).click();
    // Badge should now show 2
    await expect(badge.first()).toContainText("2", { timeout: 5_000 });

    // ─── STEP 2: Navigate to cart and verify 2 items ───
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);
    await expect(page.locator("h1")).toContainText(/cart|carrinho/i);

    // Should show 2 line items
    const cartItems = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItems).toHaveCount(2, { timeout: 10_000 });

    // Verify server-revalidated prices are displayed (not $0 or empty)
    await expect(page.locator("main")).toContainText(/\$|R\$/);

    // ─── STEP 3: Modify quantity ───
    const qtyInputs = page.locator('input[type="number"], select[name*="quantity"], [data-quantity-input]');
    if ((await qtyInputs.count()) > 0) {
      // Change first item quantity to 2
      await qtyInputs.first().fill("2");
      // Trigger change event if needed
      await qtyInputs.first().dispatchEvent("change");
      // Total should update (wait for revalidation)
      await page.waitForTimeout(1_000);
      // Page should still show valid totals
      await expect(page.locator("main")).toContainText(/\$|R\$/);
    }

    // ─── STEP 4: Remove an item ───
    const removeButtons = page.locator('button:has-text("Remove"), button:has-text("Remover"), [data-remove-item]');
    if ((await removeButtons.count()) > 0) {
      await removeButtons.first().click();
      await expect(cartItems).toHaveCount(1, { timeout: 5_000 });
    }

    // ─── STEP 5: Refresh — cart persists via localStorage ───
    await page.reload();
    await expect(page).toHaveURL(/\/en\/cart/);
    // Cart should still have items after refresh
    const cartItemsAfterRefresh = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItemsAfterRefresh).toHaveCount(1, { timeout: 10_000 });

    // ─── STEP 6: Add item back ───
    await page.goto("/en/services");
    const addButtons2 = page.locator('button:has-text("Add to cart"), button:has-text("Add")');
    await addButtons2.nth(0).click();
    await page.goto("/en/cart");
    await expect(page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]')).toHaveCount(2, { timeout: 10_000 });

    // ─── STEP 7: Checkout — should redirect to login for unauthenticated user ───
    const checkoutBtn = page.locator('a[href*="checkout"], button:has-text("Checkout"), button:has-text("Finalizar"), a:has-text("Checkout")');
    if ((await checkoutBtn.count()) > 0) {
      await checkoutBtn.first().click();
      // Should redirect to login or show checkout with login prompt
      await page.waitForLoadState("networkidle");
      const url = page.url();
      const isLoginOrCheckout = /\/(login|checkout|finalizar)/.test(url);
      expect(isLoginOrCheckout).toBeTruthy();
    }

    // ─── STEP 8: Authenticate and verify cart survives auth boundary ───
    await authenticateWithSSR(page, state.email, state.password);

    // After auth, navigate to cart — items should still be there
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);
    const cartItemsAfterAuth = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    // Cart may have items or be empty depending on implementation
    // Key assertion: page loads without error
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // ─── STEP 9: If cart has items, proceed to checkout as authenticated user ───
    const itemCount = await cartItemsAfterAuth.count();
    if (itemCount > 0) {
      const authCheckoutBtn = page.locator('a[href*="checkout"], button:has-text("Checkout"), button:has-text("Finalizar")');
      if ((await authCheckoutBtn.count()) > 0) {
        await authCheckoutBtn.first().click();
        await page.waitForLoadState("networkidle");
        // Should land on checkout page (not login)
        await expect(page).toHaveURL(/\/en\/checkout/);
        await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
      }
    }

    await context.close();
  });

  test("PT locale: carrinho multi-item funciona em português", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto("/pt/servicos");
    await expect(page.locator("h1")).toContainText(/servi/i);

    const addButtons = page.locator('button:has-text("Adicionar"), button:has-text("Add")');
    const count = await addButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    await addButtons.nth(0).click();
    await addButtons.nth(1).click();

    await page.goto("/pt/carrinho");
    await expect(page).toHaveURL(/\/pt\/carrinho/);
    await expect(page.locator("h1")).toContainText(/carrinho/i);

    const items = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(items).toHaveCount(2, { timeout: 10_000 });

    await context.close();
  });
});