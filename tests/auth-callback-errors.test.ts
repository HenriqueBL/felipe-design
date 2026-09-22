import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession },
  })),
}));

import { GET } from "@/app/auth/callback/route";

const PUBLIC_ORIGIN = "https://felipesilvadesign.com";
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

describe("GET /auth/callback (hardened error handling)", () => {
  it("redirects EN error to /en/login with callback_error and preserves safe next", async () => {
    const response = await GET(
      new Request(
        `${INTERNAL_URL}?error=access_denied&error_description=Email%20link%20is%20invalid&next=/en/account`,
      ),
    );
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/en/login`);
    expect(loc).toContain("error=callback_error");
    expect(loc).toContain(`next=${encodeURIComponent("/en/account")}`);
    // Raw error_description must NOT leak
    expect(loc).not.toContain("error_description=");
    expect(loc).not.toContain("invalid");
  });

  it("redirects PT error to /pt/login preserving locale and next", async () => {
    const response = await GET(
      new Request(
        `${INTERNAL_URL}?error=access_denied&next=/pt/conta`,
      ),
    );
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/pt/login`);
    expect(loc).toContain("error=callback_error");
    expect(loc).toContain(`next=${encodeURIComponent("/pt/conta")}`);
  });

  it("preserves full safe next path including query on PT checkout error", async () => {
    const response = await GET(
      new Request(
        `${INTERNAL_URL}?error=access_denied&next=/pt/finalizar?cart=1`,
      ),
    );
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/pt/login`);
    expect(loc).toContain("error=callback_error");
    expect(loc).toContain(`next=${encodeURIComponent("/pt/finalizar?cart=1")}`);
  });

  it("rejects external next and falls back to /en/login without leaking URL", async () => {
    const response = await GET(
      new Request(
        `${INTERNAL_URL}?error=access_denied&next=https://evil.example.com/phish`,
      ),
    );
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/en/login`);
    expect(loc).toContain("error=callback_error");
    expect(loc).not.toContain("evil");
    expect(loc).not.toContain("phish");
    expect(loc).not.toContain("next=");
  });

  it("strips raw error.message from code exchange failure redirect", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("Internal Supabase failure: token revoked"),
    });
    const response = await GET(new Request(`${INTERNAL_URL}?code=bad`));
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/en/login`);
    expect(loc).toContain("error=callback_error");
    expect(loc).not.toContain("error_description=");
    expect(loc).not.toContain("token");
    expect(loc).not.toContain("revoked");
    expect(loc).not.toContain("Internal");
  });

  it("never exposes internal origin in any error redirect", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("some failure"),
    });
    const response = await GET(new Request(`${INTERNAL_URL}?code=bad`));
    expect(location(response)).not.toContain("0.0.0.0");
  });

  it("valid callback still works without regression", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(
      new Request(`${INTERNAL_URL}?code=valid-code&next=/pt/conta`),
    );
    const loc = location(response);
    expect(loc).toBe(`${PUBLIC_ORIGIN}/pt/conta`);
  });

  it("valid callback without next defaults to /en", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(new Request(`${INTERNAL_URL}?code=valid-code`));
    expect(location(response)).toBe(`${PUBLIC_ORIGIN}/en`);
  });
});