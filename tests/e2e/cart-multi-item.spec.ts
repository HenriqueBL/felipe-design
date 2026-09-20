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

  test("full happy path: add 2 items → persist → auth → checkout → order created → cart cleared → redirect", async ({ browser }) => {
    // ─── STEP 1: Unauthenticated visitor adds two plans ───
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto("/en/services");
    await expect(page.locator("h1")).toContainText(/services/i);

    const addToCartButtons = page.locator('button:has-text("Add to cart"), button:has-text("Add")');
    await expect(addToCartButtons).toHaveCount(await addToCartButtons.count(), { timeout: 10_000 });
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
    const checkoutItems = page.locator('.cart-item, [data-cart-item], li[class*="item"]');
    await expect(checkoutItems).toHaveCount(2, { timeout: 10_000 });

    // Submit the order
    const submitBtn = page.locator('button[type="submit"]:has-text("Place order"), button[type="submit"]:has-text("Finalizar pedido")');
    await expect(submitBtn.first()).toBeVisible({ timeout: 10_000 });
    await submitBtn.first().click();

    // ─── STEP 6: Must redirect to account order page (not stay on checkout) ───
    await expect(page).toHaveURL(/\/en\/account\/orders\//, { timeout: 30_000 });

    // ─── STEP 7: Order detail must show 2 items ───
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    // The order detail page should contain item breakdown info
    await expect(page.locator("main")).toContainText(/angle|ângulo/i, { timeout: 10_000 });

    // ─── STEP 8: Cart MUST be empty after successful order ───
    await page.goto("/en/cart");
    await expect(page).toHaveURL(/\/en\/cart/);
    // Cart should now be empty — either shows empty state or 0 items
    const cartItemsAfterOrder = page.locator('[data-cart-item], .cart-item, tr[data-item], li[data-item]');
    await expect(cartItemsAfterOrder).toHaveCount(0, { timeout: 10_000 });

    await context.close();
  });

  test("EN currency preservation: services?currency=BRL → cart shows BRL", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

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

  test("PT currency preservation: servicos?currency=USD → carrinho mostra USD", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

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

    await context.close();
  });
});