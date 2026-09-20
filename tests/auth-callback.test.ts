import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

import { GET } from "@/app/auth/callback/route";

const PUBLIC_ORIGIN = "https://felipesilvadesign.com";
// Simula o request chegando ao Next atras do nginx/Docker.
const INTERNAL_URL = "http://0.0.0.0:3000/auth/callback";

function location(response: Response): string {
  return response.headers.get("location") ?? "";
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", PUBLIC_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  exchangeCodeForSession.mockReset();
});

describe("GET /auth/callback (origin publica)", () => {
  it("redireciona para a origin publica apos trocar o code por sessao", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new Request(`${INTERNAL_URL}?code=abc`));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(location(response)).toBe(`${PUBLIC_ORIGIN}/en`);
  });

  it("preserva next=/pt validos na origin publica", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(
      new Request(`${INTERNAL_URL}?code=abc&next=/pt`),
    );
    expect(location(response)).toBe(`${PUBLIC_ORIGIN}/pt`);
  });

  it("rejeita next externo e cai para /en na origin publica", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(
      new Request(`${INTERNAL_URL}?code=abc&next=https://evil.example.com`),
    );
    expect(location(response)).toBe(`${PUBLIC_ORIGIN}/en`);
  });

  it("manda para /en/login quando a troca de sessao falha", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("invalid_grant"),
    });
    const response = await GET(new Request(`${INTERNAL_URL}?code=bad`));
    expect(location(response)).toBe(`${PUBLIC_ORIGIN}/en/login`);
  });

  it("manda para /en/login quando nao ha code", async () => {
    const response = await GET(new Request(INTERNAL_URL));
    expect(location(response)).toBe(`${PUBLIC_ORIGIN}/en/login`);
  });

  it("nunca expoe a origin interna 0.0.0.0:3000 no Location", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    for (const qs of [
      "?code=abc",
      "?code=abc&next=/pt",
      "?code=abc&next=https://evil.example.com",
      "?code=bad",
      "",
    ]) {
      const response = await GET(new Request(`${INTERNAL_URL}${qs}`));
      expect(location(response)).not.toContain("0.0.0.0");
    }
  });
});
