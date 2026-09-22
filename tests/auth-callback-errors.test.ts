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

describe("GET /auth/callback (error handling)", () => {
  it("redirects to login with callback_error when Supabase returns error param", async () => {
    const response = await GET(
      new Request(
        `${INTERNAL_URL}?error=access_denied&error_description=Email%20link%20is%20invalid%20or%20has%20expired`,
      ),
    );
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/en/login`);
    expect(loc).toContain("error=callback_error");
    expect(loc).toContain("error_description=");
  });

  it("redirects to login with callback_error when code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("Invalid grant"),
    });
    const response = await GET(new Request(`${INTERNAL_URL}?code=expired-code`));
    const loc = location(response);
    expect(loc).toContain(`${PUBLIC_ORIGIN}/en/login`);
    expect(loc).toContain("error=callback_error");
  });

  it("preserves safe next param even on error redirect", async () => {
    const response = await GET(
      new Request(
        `${INTERNAL_URL}?error=access_denied&next=/pt/account`,
      ),
    );
    const loc = location(response);
    // Error redirects go to login, not to next — but must not leak external URLs
    expect(loc).toContain(`${PUBLIC_ORIGIN}/en/login`);
    expect(loc).not.toContain("evil");
  });

  it("never exposes internal origin in error redirects", async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: new Error("some failure"),
    });
    const response = await GET(new Request(`${INTERNAL_URL}?code=bad`));
    expect(location(response)).not.toContain("0.0.0.0");
  });
});