import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Production smoke suite — read-only, idempotent, BASE_URL-parameterized.
 *
 * Run: SMOKE_BASE_URL=http://localhost:3000 npm run test:smoke
 *
 * Geo-lock: every request must declare a country via x-test-country header.
 * EN routes use US; PT routes use BR. Root redirects depend on country.
 * In production this header is ignored (TRUSTED_GEO_SOURCE gates real geo).
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const urls: string[] = [];

type Country = "US" | "BR";

async function get(
  path: string,
  country: Country,
  init?: RequestInit,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  urls.push(url);
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new Error(`Smoke suite is read-only: ${method} ${path} rejected`);
  }
  const headers = new Headers(init?.headers);
  headers.set("x-test-country", country);
  return fetch(url, { redirect: "manual", ...init, method: "GET", headers });
}

let enHomeHtml = "";

beforeAll(async () => {
  if (!/^https?:\/\//.test(BASE_URL)) {
    throw new Error(`Invalid SMOKE_BASE_URL: ${BASE_URL}`);
  }
  const enRes = await get("/en", "US");
  enHomeHtml = await enRes.text();
  // PT homepage is fetched to verify it responds; content checked via
  // per-request assertions below rather than a module-level variable.
  const ptRes = await get("/pt", "BR");
  expect(ptRes.status).toBe(200);
});

afterAll(() => {
  if (urls.length) {
    console.info(`Smoke suite made ${urls.length} GET requests (read-only).`);
  }
});

describe("homepage", () => {
  it("EN homepage responds 200 for US", async () => {
    const res = await get("/en", "US");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("PT homepage responds 200 for BR", async () => {
    const res = await get("/pt", "BR");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("root redirects US to /en", async () => {
    const res = await get("/", "US");
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/en/);
  });

  it("root redirects BR to /pt", async () => {
    const res = await get("/", "BR");
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/pt/);
  });

  it("no language switch UI present on EN homepage", () => {
    // No manual locale selector should exist; hreflang metadata is fine
    // but visible UI links like "Português" or "/pt" nav toggles must be absent.
    expect(enHomeHtml).not.toMatch(
      /class="[^"]*language-switch|class="[^"]*locale-switch/i,
    );
  });

  it("no currency switch UI present on EN homepage", () => {
    expect(enHomeHtml).not.toMatch(
      /class="[^"]*currency-toggle|class="[^"]*currency-switch/i,
    );
  });
});

describe("assets", () => {
  it("main JS/CSS assets referenced by EN homepage load", async () => {
    const assetPaths = [
      ...enHomeHtml.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g),
    ]
      .map((m) => m[1])
      .filter(
        (p): p is string => p !== undefined && /\.(js|css)(\?|$)/.test(p),
      );
    expect(assetPaths.length).toBeGreaterThan(0);

    const checked = assetPaths.slice(0, 5);
    for (const path of checked) {
      const res = await get(path, "US");
      expect(res.status, `asset ${path}`).toBe(200);
    }
  });
});

describe("navigation", () => {
  it("EN services page responds for US", async () => {
    const res = await get("/en/services", "US");
    expect(res.status).toBe(200);
  });

  it("PT semantic service route responds for BR", async () => {
    const res = await get("/pt/servicos", "BR");
    expect(res.status).toBe(200);
  });

  it("US visitor on /pt/services gets redirected to EN", async () => {
    const res = await get("/pt/servicos", "US");
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/en\/services/);
  });

  it("BR visitor on /en/services gets redirected to PT", async () => {
    const res = await get("/en/services", "BR");
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/pt\/servicos/);
  });
});

describe("public flows", () => {
  it("EN checkout page opens for US", async () => {
    const res = await get("/en/checkout", "US");
    expect(res.status).toBe(200);
  });

  it("PT semantic checkout route opens for BR", async () => {
    const res = await get("/pt/finalizar", "BR");
    expect(res.status).toBe(200);
  });

  it("EN login page opens for US", async () => {
    const res = await get("/en/login", "US");
    expect(res.status).toBe(200);
  });

  it("PT login page opens for BR", async () => {
    const res = await get("/pt/login", "BR");
    expect(res.status).toBe(200);
  });
});

describe("private routes do not leak data", () => {
  it.each([
    { path: "/en/account", country: "US" as Country },
    { path: "/en/dashboard", country: "US" as Country },
    { path: "/pt/conta", country: "BR" as Country },
  ])(
    "$path redirects unauthenticated $country users to login",
    async ({ path, country }) => {
      const res = await get(path, country);
      expect([301, 302, 307, 308]).toContain(res.status);
      const location = res.headers.get("location") ?? "";
      expect(location).toMatch(/\/login/);
    },
  );
});

describe("nested route localization", () => {
  it("BR on /en/account/orders/<id> redirects to /pt/conta/pedidos/<id>", async () => {
    const orderId = "00000000-0000-0000-0000-000000000000";
    const res = await get(`/en/account/orders/${orderId}`, "BR");
    expect([301, 302, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`/pt/conta/pedidos/${orderId}`);
  });

  it("US on /pt/conta/pedidos/<id> redirects to /en/account/orders/<id>", async () => {
    const orderId = "00000000-0000-0000-0000-000000000000";
    const res = await get(`/pt/conta/pedidos/${orderId}`, "US");
    expect([301, 302, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`/en/account/orders/${orderId}`);
  });
});

describe("query currency override blocked", () => {
  it("BR services ignores ?currency=USD", async () => {
    const res = await get("/pt/servicos?currency=USD", "BR");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should show BRL symbol, not USD
    expect(html).toMatch(/R\$/);
  });

  it("US services ignores ?currency=BRL", async () => {
    const res = await get("/en/services?currency=BRL", "US");
    expect(res.status).toBe(200);
    const html = await res.text();
    // Should show USD symbol, not R$
    expect(html).toMatch(/\$/);
    expect(html).not.toMatch(/R\$/);
  });
});

describe("not-found behavior", () => {
  it("unknown page under locale returns 404", async () => {
    const res = await get("/en/this-page-does-not-exist-smoke", "US");
    expect(res.status).toBe(404);
  });

  it("unknown root page redirects to locale or 404s cleanly", async () => {
    const res = await get("/this-page-does-not-exist-smoke", "US");
    expect([301, 302, 307, 308, 404]).toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });
});