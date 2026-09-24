import { test, expect } from "@playwright/test";
import { getOrCreateTestPlan } from "./helpers/fixtures";
import { addFirstPlanToCartViaUI } from "./helpers/checkout";

/**
 * E2E geo-lock validation — market authority enforcement.
 *
 * Uses x-test-country header (dev/test only) to simulate BR/US markets.
 * In production this header is ignored; TRUSTED_GEO_SOURCE gates real geo.
 */

const TEST_UUID = "00000000-0000-0000-0000-000000000000";

test.describe("root redirects by country", () => {
  test("US visitor → /en", async ({ request }) => {
    const res = await request.get("/", {
      headers: { "x-test-country": "US" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/en/);
  });

  test("BR visitor → /pt", async ({ request }) => {
    const res = await request.get("/", {
      headers: { "x-test-country": "BR" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/pt/);
  });

  test("no country header → /en (fallback)", async ({ request }) => {
    const res = await request.get("/", { maxRedirects: 0 });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/en/);
  });
});

test.describe("cross-locale redirects", () => {
  test("BR on /en/services → /pt/servicos", async ({ request }) => {
    const res = await request.get("/en/services", {
      headers: { "x-test-country": "BR" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toContain("/pt/servicos");
  });

  test("US on /pt/servicos → /en/services", async ({ request }) => {
    const res = await request.get("/pt/servicos", {
      headers: { "x-test-country": "US" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toContain("/en/services");
  });

  test("PT country on /pt → /en (non-BR always EN)", async ({ request }) => {
    const res = await request.get("/pt", {
      headers: { "x-test-country": "PT" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/en/);
  });

  test("AO country on /pt → /en", async ({ request }) => {
    const res = await request.get("/pt", {
      headers: { "x-test-country": "AO" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/en/);
  });

  test("MZ country on /pt → /en", async ({ request }) => {
    const res = await request.get("/pt", {
      headers: { "x-test-country": "MZ" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    expect(res.headers()["location"]).toMatch(/\/en/);
  });
});

test.describe("nested route localization", () => {
  test("BR on /en/account/orders/<id> → /pt/conta/pedidos/<id>", async ({
    request,
  }) => {
    const res = await request.get(`/en/account/orders/${TEST_UUID}`, {
      headers: { "x-test-country": "BR" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toContain(`/pt/conta/pedidos/${TEST_UUID}`);
  });

  test("US on /pt/conta/pedidos/<id> → /en/account/orders/<id>", async ({
    request,
  }) => {
    const res = await request.get(`/pt/conta/pedidos/${TEST_UUID}`, {
      headers: { "x-test-country": "US" },
      maxRedirects: 0,
    });
    expect([301, 302, 307, 308]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toContain(`/en/account/orders/${TEST_UUID}`);
  });
});

test.describe("services currency display", () => {
  test("BR services shows BRL (R$)", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt/servicos");
    await expect(page).toHaveURL(/\/pt\/servicos/);
    // Wait for at least one plan card to render with pricing
    await expect(page.locator("article[data-plan-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    const content = await page.content();
    expect(content).toMatch(/R\$/);
  });

  test("US services shows USD ($), not BRL", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services");
    await expect(page).toHaveURL(/\/en\/services/);
    await expect(page.locator("article[data-plan-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    const content = await page.content();
    // USD uses "$" but must NOT contain "R$"
    expect(content).not.toMatch(/R\$/);
    expect(content).toMatch(/\$/);
  });

  test("BR services ignores ?currency=USD query param", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt/servicos?currency=USD");
    await expect(page.locator("article[data-plan-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    const content = await page.content();
    expect(content).toMatch(/R\$/);
  });

  test("US services ignores ?currency=BRL query param", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services?currency=BRL");
    await expect(page.locator("article[data-plan-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    const content = await page.content();
    expect(content).not.toMatch(/R\$/);
    expect(content).toMatch(/\$/);
  });

  test("no currency toggle UI on BR services", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt/servicos");
    const toggle = await page.$(
      ".currency-toggle, .cinematic-currency-toggle, [class*='currency-switch']",
    );
    expect(toggle).toBeNull();
  });

  test("no currency toggle UI on US services", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services");
    const toggle = await page.$(
      ".currency-toggle, .cinematic-currency-toggle, [class*='currency-switch']",
    );
    expect(toggle).toBeNull();
  });
});

test.describe("legacy localStorage cart preservation", () => {
  test("BR with legacy USD cart shows BRL pricing and preserves items", async ({
    page,
  }) => {
    // Get a real plan ID first
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt/servicos");
    const planArticle = page.locator("article[data-plan-id]").first();
    await expect(planArticle).toBeVisible({ timeout: 15_000 });
    const realPlanId = await planArticle.getAttribute("data-plan-id");
    expect(realPlanId).toBeTruthy();

    // Inject legacy cart with USD currency using REAL plan ID
    await page.evaluate((pid) => {
      localStorage.setItem(
        "felipe-cart-v1",
        JSON.stringify({
          currency: "USD",
          items: [{ planId: pid, quantity: 1 }],
        }),
      );
    }, realPlanId);

    // Navigate to cart page
    await page.goto("/pt/carrinho");

    // Verify item is preserved (cart must show the item, not empty state)
    await expect(page.locator("main")).toContainText(/carrinho|cart/i, {
      timeout: 10_000,
    });
    // Cart should NOT be empty — item must be present
    await expect(page.locator("main")).not.toContainText(
      /seu carrinho está vazio|your cart is empty/i,
    );

    // Verify pricing displays in BRL (server-authoritative), not USD
    const content = await page.content();
    expect(content).toMatch(/R\$/);
  });

  test("US with legacy BRL cart shows USD pricing and preserves items", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services");
    const planArticle = page.locator("article[data-plan-id]").first();
    await expect(planArticle).toBeVisible({ timeout: 15_000 });
    const realPlanId = await planArticle.getAttribute("data-plan-id");
    expect(realPlanId).toBeTruthy();

    // Inject legacy cart with BRL currency using REAL plan ID
    await page.evaluate((pid) => {
      localStorage.setItem(
        "felipe-cart-v1",
        JSON.stringify({
          currency: "BRL",
          items: [{ planId: pid, quantity: 1 }],
        }),
      );
    }, realPlanId);

    await page.goto("/en/cart");

    // Verify item is preserved
    await expect(page.locator("main")).toContainText(/cart|carrinho/i, {
      timeout: 10_000,
    });
    await expect(page.locator("main")).not.toContainText(
      /seu carrinho está vazio|your cart is empty/i,
    );

    // Verify pricing displays in USD (server-authoritative), not BRL
    const content = await page.content();
    expect(content).not.toMatch(/R\$/);
    expect(content).toMatch(/\$/);
  });
});

test.describe("cart-pricing API server authority", () => {
  let realPlanId: string;

  test.beforeAll(async () => {
    const plan = await getOrCreateTestPlan();
    realPlanId = plan.id;
  });

  test("BR request returns BRL currency", async ({ request }) => {
    const res = await request.post("/api/cart-pricing", {
      headers: {
        "x-test-country": "BR",
        "content-type": "application/json",
      },
      data: {
        items: [{ planId: realPlanId, quantity: 1 }],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("BRL");
  });

  test("US request returns USD currency", async ({ request }) => {
    const res = await request.post("/api/cart-pricing", {
      headers: {
        "x-test-country": "US",
        "content-type": "application/json",
      },
      data: {
        items: [{ planId: realPlanId, quantity: 1 }],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("USD");
  });

  test("BR request with malicious currency:USD in payload still returns BRL", async ({
    request,
  }) => {
    const res = await request.post("/api/cart-pricing", {
      headers: {
        "x-test-country": "BR",
        "content-type": "application/json",
      },
      data: {
        items: [{ planId: realPlanId, quantity: 1 }],
        currency: "USD",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("BRL");
  });
});

test.describe("real cart flow with geo authority", () => {
  test("BR full cart flow shows BRL at every step", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });

    // Step 1: Services — verify BRL pricing
    await page.goto("/pt/servicos");
    await expect(page.locator("article[data-plan-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    let content = await page.content();
    expect(content).toMatch(/R\$/);

    // Step 2: Add to cart via UI
    await addFirstPlanToCartViaUI(page, "pt");

    // Step 3: Navigate to cart
    const viewCartLink = page.getByRole("link", {
      name: /ver carrinho|view cart/i,
    });
    await expect(viewCartLink).toBeVisible({ timeout: 5_000 });
    await viewCartLink.click();
    await expect(page).toHaveURL(/\/pt\/carrinho/);

    // Verify cart shows BRL (server-authoritative)
    content = await page.content();
    expect(content).toMatch(/R\$/);

    // Step 4: Proceed to checkout
    const checkoutBtn = page.getByRole("link", {
      name: /finalizar compra|checkout/i,
    });
    await expect(checkoutBtn).toBeVisible({ timeout: 10_000 });
    await checkoutBtn.click();
    await expect(page).toHaveURL(/\/pt\/finalizar\?cart=1/);

    // Verify checkout shows BRL
    content = await page.content();
    expect(content).toMatch(/R\$/);
  });

  test("US full cart flow shows USD at every step", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });

    // Step 1: Services — verify USD pricing
    await page.goto("/en/services");
    await expect(page.locator("article[data-plan-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    let content = await page.content();
    expect(content).not.toMatch(/R\$/);
    expect(content).toMatch(/\$/);

    // Step 2: Add to cart via UI
    await addFirstPlanToCartViaUI(page, "en");

    // Step 3: Navigate to cart
    const viewCartLink = page.getByRole("link", {
      name: /view cart|ver carrinho/i,
    });
    await expect(viewCartLink).toBeVisible({ timeout: 5_000 });
    await viewCartLink.click();
    await expect(page).toHaveURL(/\/en\/cart/);

    // Verify cart shows USD
    content = await page.content();
    expect(content).not.toMatch(/R\$/);
    expect(content).toMatch(/\$/);

    // Step 4: Proceed to checkout
    const checkoutBtn = page.getByRole("link", {
      name: /checkout|finalizar compra/i,
    });
    await expect(checkoutBtn).toBeVisible({ timeout: 10_000 });
    await checkoutBtn.click();
    await expect(page).toHaveURL(/\/en\/checkout\?cart=1/);

    // Verify checkout shows USD
    content = await page.content();
    expect(content).not.toMatch(/R\$/);
    expect(content).toMatch(/\$/);
  });
});

test.describe("no language/currency selector UI", () => {
  test("EN homepage has no language switch UI", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en");
    const langSwitch = await page.$(
      '[class*="language-switch"], [class*="locale-switch"]',
    );
    expect(langSwitch).toBeNull();
  });

  test("EN homepage has no currency switch UI", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en");
    const currSwitch = await page.$(
      '[class*="currency-toggle"], [class*="currency-switch"]',
    );
    expect(currSwitch).toBeNull();
  });
});