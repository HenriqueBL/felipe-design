/**
 * E2E Auth Helpers — programmatic authentication for Playwright tests.
 * Uses Supabase Admin API to generate Magic Links without manual email access.
 * Service role is used ONLY in test harness setup/cleanup, never exposed to browser.
 */
import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database";

let adminClient: SupabaseClient<Database> | null = null;

export function getAdminClient(): SupabaseClient<Database> {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("E2E AUTH: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    adminClient = createClient<Database>(url, key, {
      auth: { persistSession: false },
    });
  }
  return adminClient;
}

/**
 * Create a fresh admin client, bypassing the singleton cache.
 * Use this in cleanup/teardown to avoid state corruption from prior operations.
 */
/**
 * Create a pure service-role client for cleanup/teardown.
 * NEVER shares state with getAdminClient() or any user session.
 * Explicitly disables all session management to prevent JWT contamination.
 */
export function createFreshAdminClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("E2E AUTH: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Generate a Magic Link for an existing user via Admin API.
 * Returns the full action_link URL that Supabase would send by email.
 */
export async function generateMagicLink(email: string): Promise<string> {
  const admin = getAdminClient();
  const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${origin}/auth/callback?next=/en`,
    },
  });

  if (error) {
    throw new Error(`E2E AUTH: Failed to generate magic link for ${email}: ${error.message}`);
  }

  // Use the action_link directly when available (Supabase constructs the full verification URL)
  if (data.properties?.action_link) {
    return data.properties.action_link;
  }

  // Fallback: construct from hashed_token if action_link is not returned
  if (data.properties?.hashed_token) {
    return `${origin}/auth/callback?token=${data.properties.hashed_token}&type=magiclink&redirect_to=${encodeURIComponent(`${origin}/en`)}`;
  }

  throw new Error("E2E AUTH: generateLink returned neither action_link nor hashed_token");
}

/**
 * Create a test user with password (for direct login when needed).
 * Returns { userId, email, password }.
 */
export async function createTestUser(
  prefix: string,
  role: "user" | "admin" = "user",
): Promise<{ userId: string; email: string; password: string }> {
  const admin = getAdminClient();
  const timestamp = Date.now();
  const email = `e2e-${prefix}-${timestamp}@test.felipedesign.local`;
  const password = `E2E-Test-Pass-${timestamp}-!Aa1`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`E2E AUTH: Failed to create user: ${userError?.message}`);
  }

  // Ensure profile exists with correct role
  // Map test role ("user"|"admin") to DB enum ("customer"|"admin")
  const dbRole = role === "user" ? "customer" : "admin";
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userData.user.id,
    email: email,
    role: dbRole,
  });

  if (profileError) {
    await admin.from("profiles").update({ role: dbRole }).eq("id", userData.user.id);
  }

  return { userId: userData.user.id, email, password };
}

/**
 * Delete a test user and associated data (cleanup).
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.auth.admin.deleteUser(userId);
}

/**
 * Sign in programmatically and return session tokens.
 * Uses a FRESH client to avoid contaminating the singleton getAdminClient()
 * with user JWT state. Each sign-in gets an isolated client instance.
 */
export async function signInAsUser(
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const client = createFreshAdminClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`E2E AUTH: Sign-in failed for ${email}: ${error?.message}`);
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

/**
 * Authenticate a Playwright Page using the real Magic Link flow + Admin API token interception.
 *
 * Strategy:
 * 1. Navigate to the login page
 * 2. Fill the email and submit the form (triggers Supabase to send magic link)
 * 3. Use Admin API to generate the same magic link token server-side
 * 4. Navigate to the action_link URL in the same browser context
 * 5. The /auth/callback route exchanges the code for a real session
 * 6. Redirect back to the intended destination with a valid session
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- password param kept for interface consistency with other auth helpers; magic link flow does not use it
export async function authenticateBrowserPage(
  page: import("@playwright/test").Page,
  email: string,
  _password: string,
): Promise<void> {
  // Step 1: Go to login page
  await page.goto("/en/login");
  await expect(page.locator("h1")).toContainText(/sign in/i);

  // Step 2: Fill email and submit to trigger magic link sending
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');

  // Wait for success message confirming email was sent
  await expect(page.locator('.form-status.ok, p:has-text("Check your inbox")')).toBeVisible({ timeout: 10_000 });

  // Step 3: Generate magic link via Admin API (bypasses actual email delivery)
  const verifyUrl = await generateMagicLink(email);

  // Step 4: Navigate to the verification URL in the same browser context
  await page.goto(verifyUrl);

  // Step 5: Wait for redirect to complete (callback exchanges token for session)
  await expect(page).toHaveURL(/\/en/, { timeout: 15_000 });

  // Verify session is established by checking we can access a protected route
  await page.goto("/en/account");
  await expect(page).toHaveURL(/\/en\/account/, { timeout: 10_000 });
}
