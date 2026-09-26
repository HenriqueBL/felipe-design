/**
 * E2E SSR Auth — generates valid Supabase SSR cookies for Playwright browser contexts.
 * Uses @supabase/ssr's createServerClient with an in-memory cookie adapter to produce
 * the exact cookie format that Next.js middleware and Server Components expect.
 *
 * This avoids hardcoding cookie names/chunking and ensures compatibility across
 * Supabase SDK versions.
 */
import { createServerClient } from "@supabase/ssr";
import { signInAsUser } from "./auth";

interface GeneratedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Generate SSR-compatible session cookies by signing in via Admin API
 * and using @supabase/ssr to serialize the session into the correct cookie format.
 */
export async function generateSSRSessionCookies(
  email: string,
  password: string,
): Promise<GeneratedCookie[]> {
  // Step 1: Obtain tokens via Admin API (server-side only)
  const { accessToken, refreshToken } = await signInAsUser(email, password);

  // Step 2: Use @supabase/ssr to serialize session into cookies
  const cookies: GeneratedCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            cookies.push({
              name: cookie.name,
              value: cookie.value,
              domain: "localhost",
              path: cookie.options?.path ?? "/",
              httpOnly: cookie.options?.httpOnly ?? false,
              secure: cookie.options?.secure ?? false,
              sameSite: (cookie.options?.sameSite as "Strict" | "Lax" | "None") ?? "Lax",
            });
          }
        },
      },
    },
  );

  // Step 3: Set the session — this triggers setAll with properly formatted cookies
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    throw new Error(`E2E SSR AUTH: Failed to set session: ${error.message}`);
  }

  return cookies;
}

/**
 * Authenticate a Playwright Page using SSR-compatible cookies.
 * Generates valid cookies via @supabase/ssr and injects them into the browser context.
 * This produces a session that Next.js middleware and Server Components recognize.
 */
export async function authenticateWithSSR(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  const cookies = await generateSSRSessionCookies(email, password);

  // Inject cookies into the browser context
  // Normalize sameSite to Playwright's strict enum ("Strict" | "Lax" | "None")
  const normalizeSameSite = (
    val: string | undefined,
  ): "Strict" | "Lax" | "None" => {
    if (!val) return "Lax";
    const lower = val.toLowerCase();
    if (lower === "strict") return "Strict";
    if (lower === "none") return "None";
    return "Lax";
  };

  await page.context().addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? "localhost",
      path: c.path ?? "/",
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: normalizeSameSite(c.sameSite),
    })),
  );

  // Navigate to an admin-protected page to trigger middleware session recognition
  // without leaving the dashboard context. The previous approach of navigating to
  // /en caused public-page redirects that lost the session; skipping navigation
  // entirely caused RSC to not receive cookies on the first admin page load.
  // /en/dashboard is protected by middleware (requires auth + admin role), so it
  // validates the session and primes the cookie jar for subsequent navigations.
  await page.goto("/en/dashboard");
  await page.waitForLoadState("networkidle");
}