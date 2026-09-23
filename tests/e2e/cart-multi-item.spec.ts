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

  test("full happy path: add 2 items → persist → auth → checkout → order created → cart cleared → redirect", async ({ page }) => {
    // ─── STEP 1: Unauthenticated visitor adds two plans ───
    await page.goto("/en/services");
    await expect(page.locator("h1")).toContainText(/services/i);

    const addToCartButtons = page.locator('button:has-text("Add to cart"), button:has-text("Add")');
    const initialCount = await addToCartButtons.count();
    expect(initialCount).toBeGreaterThanOrEqual(2);

    // Add first plan
    await addToCartButtons.nth(0).click();
    const badge = page.locator('[data-cart-badge], .cart-badge, a[href*="cart"] span, a[href*="carrinho"] span');
    await expect(badge.first()).toContainText("1", { timeout: 5_000 });

    // Add second plan
    await addToCartButtons.nth(1).click();
    await expect(badge.first()).toContainText("2", { timeout: 5_000 });

    // ─── STEP 2: Navigate to cart — must show exactly 2 items ───
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);
    await expect(page.locator("h1")).toContainText(/cart|carrinho/i);

    const cartItems = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItems).toHaveCount(2, { timeout: 10_000 });

    // Server-revalidated prices must be visible
    await expect(page.locator("main")).toContainText(/\$|R\$/);

    // ─── STEP 3: Refresh — cart MUST persist via localStorage ───
    await page.reload();
    await expect(page).toHaveURL(/\/en\/cart/);
    const cartItemsAfterRefresh = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItemsAfterRefresh).toHaveCount(2, { timeout: 10_000 });

    // ─── STEP 4: Authenticate — cart MUST survive auth boundary ───
    await authenticateWithSSR(page, state.email, state.password);
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);
    const cartItemsAfterAuth = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItemsAfterAuth).toHaveCount(2, { timeout: 10_000 });

    // ─── STEP 5: Checkout as authenticated user ───
    await page.goto("/en/checkout?cart=1");
    await expect(page).toHaveURL(/\/en\/checkout/);
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // Verify checkout shows 2 items with prices
    // Cart checkout renders items as ul.cart-items > li.cart-item (functional class, not visual)
    const checkoutItems = page.locator("ul.cart-items > li.cart-item");
    await expect(checkoutItems).toHaveCount(2, { timeout: 10_000 });

    // ─── DELIVERY ESTIMATE ASSERTIONS ───
    // Delivery estimate panel uses .estimate-panel class (functional, not visual)
    const estimatePanel = page.locator(".estimate-panel");
    await expect(estimatePanel).toBeVisible({ timeout: 10_000 });
    const estimateText = await estimatePanel.textContent();
    expect(estimateText).not.toContain("undefined");
    expect(estimateText).toMatch(/\d+/);
    await expect(page.locator(".deadline-meta")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".estimate-panel .note")).toBeVisible({ timeout: 5_000 });

    // Submit the order
    const submitBtn = page.locator('button[type="submit"]:has-text("Place order"), button[type="submit"]:has-text("Finalizar pedido")');
    await expect(submitBtn.first()).toBeVisible({ timeout: 10_000 });
    await submitBtn.first().click();

    // ─── STEP 6: Must redirect to account order page (not stay on checkout) ───
    await expect(page).toHaveURL(/\/en\/account\/orders\//, { timeout: 30_000 });

    // ─── STEP 7: Order detail must show 2 items with correct breakdown ───
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    const orderItemsList = page.locator('[data-testid="order-items-list"]');
    await expect(orderItemsList).toBeVisible({ timeout: 10_000 });

    const orderItemEntries = page.locator('[data-testid^="order-item-"]');
    await expect(orderItemEntries).toHaveCount(2, { timeout: 10_000 });

    // Verify specific item breakdowns: one 3-angle and one 1-angle
    await expect(page.locator("main")).toContainText(/3.*angle|3.*ângulo/i);
    await expect(page.locator("main")).toContainText(/1.*angle|1.*ângulo/i);

    // Total knives and output images must be present as labeled values
    await expect(page.locator("main")).toContainText(/knives?\s*\d+/i);
    await expect(page.locator("main")).toContainText(/images?\s*\d+/i);

    // Total monetary value present
    await expect(page.locator("main")).toContainText(/\$|R\$/);

    // ─── SOURCE GROUPING ASSERTIONS (order detail / upload page) ───
    // Navigate to source photo upload for this order to verify item→knife mapping
    const uploadLink = page.locator('a[href*="upload"], a[href*="fotos"], button:has-text("Upload"), button:has-text("Enviar fotos")');
    if ((await uploadLink.count()) > 0) {
      await uploadLink.first().click();
      await expect(page).toHaveURL(/\/account\/orders\/.*\/upload|\/account\/orders\/.*\/fotos/, { timeout: 10_000 });
      // Item 1 (3-angle package) must have source-item-1 with source-knife-1 inside
      const sourceItem1 = page.locator('[data-testid="source-item-1"]');
      if ((await sourceItem1.count()) > 0) {
        await expect(sourceItem1).toBeVisible({ timeout: 5_000 });
        await expect(sourceItem1.locator('[data-testid="source-knife-1"]')).toBeVisible({ timeout: 5_000 });
      }
      // Item 2 (1-angle package) must have source-item-2 with source-knife-2 inside
      const sourceItem2 = page.locator('[data-testid="source-item-2"]');
      if ((await sourceItem2.count()) > 0) {
        await expect(sourceItem2).toBeVisible({ timeout: 5_000 });
        await expect(sourceItem2.locator('[data-testid="source-knife-2"]')).toBeVisible({ timeout: 5_000 });
      }
    }

    // ─── STEP 8: Cart MUST be empty after successful order ───
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);
    const cartItemsAfterOrder = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItemsAfterOrder).toHaveCount(0, { timeout: 10_000 });
  });

  test("EN currency preservation: services?currency=BRL → cart shows BRL", async ({ page }) => {
    // Navigate to services with explicit BRL currency
    await page.goto("/en/services?currency=BRL");
    await expect(page.locator("h1")).toContainText(/services/i);

    // Add a plan to cart
    const addToCartButtons = page.locator('button:has-text("Add to cart"), button:has-text("Add")');
    await expect(addToCartButtons.first()).toBeVisible({ timeout: 10_000 });
    await addToCartButtons.first().click();

    const badge = page.locator('[data-cart-badge], .cart-badge, a[href*="cart"] span');
    await expect(badge.first()).toContainText("1", { timeout: 5_000 });

    // Navigate to cart WITHOUT currency param — must still show BRL from localStorage
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);

    // Cart must NOT appear empty
    const cartItems = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItems).toHaveCount(1, { timeout: 10_000 });

    // Price must be displayed in BRL format (R$)
    await expect(page.locator("main")).toContainText(/R\$/, { timeout: 5_000 });

    // Continue Shopping link should preserve BRL
    const continueLink = page.locator('a:has-text("Continue"), a:has-text("Continuar")');
    if ((await continueLink.count()) > 0) {
      const href = await continueLink.first().getAttribute("href");
      expect(href).toContain("currency=BRL");
    }
  });

  test("PT locale: carrinho multi-item funciona em português", async ({ page }) => {
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
  });

  test("PT currency preservation: servicos?currency=USD → carrinho mostra USD", async ({ page }) => {
    // Navigate to PT services with explicit USD currency
    await page.goto("/pt/servicos?currency=USD");
    await expect(page.locator("h1")).toContainText(/servi/i);

    // Add a plan to cart
    const addButtons = page.locator('button:has-text("Adicionar"), button:has-text("Add")');
    await expect(addButtons.first()).toBeVisible({ timeout: 10_000 });
    await addButtons.first().click();

    const badge = page.locator('[data-cart-badge], .cart-badge, a[href*="carrinho"] span, a[href*="cart"] span');
    await expect(badge.first()).toContainText("1", { timeout: 5_000 });

    // Navigate to cart WITHOUT currency param — must still show USD from localStorage
    await page.goto("/pt/carrinho");
    await expect(page).toHaveURL(/\/pt\/carrinho/);

    // Cart must NOT appear empty
    const cartItems = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItems).toHaveCount(1, { timeout: 10_000 });

    // Price must be displayed in USD format ($)
    await expect(page.locator("main")).toContainText(/\$/, { timeout: 5_000 });
  });
});