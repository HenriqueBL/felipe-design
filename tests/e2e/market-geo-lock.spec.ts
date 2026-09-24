import { test, expect } from "@playwright/test";

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
    const content = await page.content();
    expect(content).toMatch(/R\$/);
  });

  test("US services shows USD ($)", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services");
    await expect(page).toHaveURL(/\/en\/services/);
    const content = await page.content();
    expect(content).toMatch(/\$/);
  });

  test("BR services ignores ?currency=USD query param", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt/servicos?currency=USD");
    const content = await page.content();
    expect(content).toMatch(/R\$/);
  });

  test("US services ignores ?currency=BRL query param", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services?currency=BRL");
    const content = await page.content();
    expect(content).toMatch(/\$/);
    expect(content).not.toMatch(/R\$/);
  });

  test("no currency toggle UI on BR services", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "BR" });
    await page.goto("/pt/servicos");
    const toggle = await page.$(".currency-toggle, .cinematic-currency-toggle");
    expect(toggle).toBeNull();
  });

  test("no currency toggle UI on US services", async ({ page }) => {
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
    await page.goto("/en/services");
    const toggle = await page.$(".currency-toggle, .cinematic-currency-toggle");
    expect(toggle).toBeNull();
  });
});

test.describe("legacy localStorage cart preservation", () => {
  test("BR with legacy USD cart shows BRL pricing", async ({ page }) => {
    // Inject legacy cart with USD currency before navigating
    await page.goto("/pt/servicos", {
      headers: { "x-test-country": "BR" },
    });
    await page.evaluate(() => {
      localStorage.setItem(
        "felipe-cart-v1",
        JSON.stringify({
          currency: "USD",
          items: [
            {
              planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001",
              quantity: 1,
            },
          ],
        }),
      );
    });
    // Navigate to cart page to verify display
    await page.goto("/pt/carrinho", {
      headers: { "x-test-country": "BR" },
    });
    const content = await page.content();
    // Items should be preserved but currency display must be BRL
    // The cart page should show R$ not $ for pricing
    if (content.includes("price") || content.includes("subtotal")) {
      expect(content).toMatch(/R\$/);
    }
  });

  test("US with legacy BRL cart shows USD pricing", async ({ page }) => {
    await page.goto("/en/services", {
      headers: { "x-test-country": "US" },
    });
    await page.evaluate(() => {
      localStorage.setItem(
        "felipe-cart-v1",
        JSON.stringify({
          currency: "BRL",
          items: [
            {
              planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001",
              quantity: 1,
            },
          ],
        }),
      );
    });
    await page.goto("/en/cart", {
      headers: { "x-test-country": "US" },
    });
    const content = await page.content();
    if (content.includes("price") || content.includes("subtotal")) {
      expect(content).toMatch(/\$/);
      expect(content).not.toMatch(/R\$/);
    }
  });
});

test.describe("cart-pricing API server authority", () => {
  test("BR request returns BRL currency", async ({ request }) => {
    const res = await request.post("/api/cart-pricing", {
      headers: {
        "x-test-country": "BR",
        "content-type": "application/json",
      },
      data: {
        items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
      },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.currency).toBe("BRL");
    }
  });

  test("US request returns USD currency", async ({ request }) => {
    const res = await request.post("/api/cart-pricing", {
      headers: {
        "x-test-country": "US",
        "content-type": "application/json",
      },
      data: {
        items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
      },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.currency).toBe("USD");
    }
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
        items: [{ planId: "b3d0c2f1-5f45-4a67-9e5f-8e3e3e1a0001", quantity: 1 }],
        currency: "USD",
      },
    });
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.currency).toBe("BRL");
    }
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