import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Production smoke suite — read-only, idempotent, BASE_URL-parameterized.
 *
 * Run: SMOKE_BASE_URL=http://localhost:3000 npm run test:smoke
 *
 * Guarantees:
 * - Only GET requests; no form submissions, no uploads, no payment simulation.
 * - No credentials, no secrets, no order creation.
 * - No hardcoded production domain.
 *
 * Authenticated smoke is a future extension: see tests/smoke/README.md.
 */

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

const urls: string[] = [];

async function get(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  urls.push(url);
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    throw new Error(`Smoke suite is read-only: ${method} ${path} rejected`);
  }
  return fetch(url, { redirect: "manual", ...init, method: "GET" });
}

let homeHtml = "";

beforeAll(async () => {
  if (!/^https?:\/\//.test(BASE_URL)) {
    throw new Error(`Invalid SMOKE_BASE_URL: ${BASE_URL}`);
  }
  const res = await get("/en");
  homeHtml = await res.text();
});

afterAll(() => {
  if (urls.length) {
    console.info(`Smoke suite made ${urls.length} GET requests (read-only).`);
  }
});

describe("homepage", () => {
  it("EN homepage responds 200", async () => {
    const res = await get("/en");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("PT homepage responds 200", async () => {
    const res = await get("/pt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("root redirects to default locale", async () => {
    const res = await get("/");
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get("location")).toMatch(/\/en/);
  });
});

describe("assets", () => {
  it("main JS/CSS assets referenced by homepage load", async () => {
    const assetPaths = [...homeHtml.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)]
      .map((m) => m[1])
      .filter((p): p is string => p !== undefined && /\.(js|css)(\?|$)/.test(p));
    expect(assetPaths.length).toBeGreaterThan(0);

    const checked = assetPaths.slice(0, 5); // keep suite fast
    for (const path of checked) {
      const res = await get(path);
      expect(res.status, `asset ${path}`).toBe(200);
    }
  });
});

describe("navigation", () => {
  it("EN services page responds", async () => {
    const res = await get("/en/services");
    expect(res.status).toBe(200);
  });

  it("PT semantic service route responds (rewrite)", async () => {
    const res = await get("/pt/servicos");
    expect(res.status).toBe(200);
  });

  it("EN locale switch links present on homepage", async () => {
    expect(homeHtml).toMatch(/href="[^"]*\/pt[^"]*"/);
  });
});

describe("public flows", () => {
  it("public checkout page opens", async () => {
    const res = await get("/en/checkout");
    expect(res.status).toBe(200);
  });

  it("PT semantic checkout route opens (rewrite)", async () => {
    const res = await get("/pt/finalizar");
    expect(res.status).toBe(200);
  });

  it("login page opens", async () => {
    const res = await get("/en/login");
    expect(res.status).toBe(200);
  });
});

describe("private routes do not leak data", () => {
  it.each([
    "/en/account",
    "/en/dashboard",
    "/pt/conta",
  ])("%s redirects unauthenticated users to login", async (path) => {
    const res = await get(path);
    expect([301, 302, 307, 308]).toContain(res.status);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/\/login/);
  });
});

describe("not-found behavior", () => {
  it("unknown page under locale returns 404", async () => {
    const res = await get("/en/this-page-does-not-exist-smoke");
    expect(res.status).toBe(404);
  });

  it("unknown root page redirects to locale or 404s cleanly", async () => {
    const res = await get("/this-page-does-not-exist-smoke");
    expect([200, 301, 302, 307, 308, 404]).toContain(res.status);
    expect(res.status).toBeLessThan(500);
  });
});