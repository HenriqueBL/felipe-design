import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, getAdminClient } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";

test.describe("Portfolio Admin Auth Diagnostic", () => {
  let adminUserId: string;
  let adminEmail: string;
  let adminPassword: string;

  test.beforeAll(async () => {
    const user = await createTestUser("auth-diag", "admin");
    adminUserId = user.userId;
    adminEmail = user.email;
    adminPassword = user.password;
  });

  test.afterAll(async () => {
    if (adminUserId) {
      await cleanupUserData(adminUserId).catch(() => {});
      await deleteTestUser(adminUserId).catch(() => {});
    }
  });

  test("diagnostic: verify auth session is recognized by middleware", async ({ page }) => {
    // Step 1: Verify user exists and has admin role via service role
    const admin = getAdminClient();
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, role, email")
      .eq("id", adminUserId)
      .maybeSingle();

    console.log("[AUTH-DIAG] Profile check:", {
      userId: adminUserId,
      profileExists: !!profile,
      role: profile?.role,
      email: profile?.email,
      error: profileErr?.message
    });
    expect(profile).toBeTruthy();
    expect(profile!.role).toBe("admin");

    // Step 2: Authenticate via SSR cookie injection
    await authenticateWithSSR(page, adminEmail, adminPassword);

    // Step 3: Check cookies were set (names only, no values)
    const cookies = await page.context().cookies();
    const cookieNames = cookies.map(c => c.name);
    console.log("[AUTH-DIAG] Cookie names:", cookieNames);
    console.log("[AUTH-DIAG] Cookie count:", cookies.length);

    // Verify we have Supabase session cookies
    const hasSessionCookie = cookieNames.some(n => n.includes("sb-") || n.includes("session"));
    console.log("[AUTH-DIAG] Has session cookie:", hasSessionCookie);

    // Step 4: Navigate to dashboard and capture redirect chain
    const response = await page.goto("/en/dashboard/portfolio", {
      waitUntil: "networkidle",
      timeout: 15_000
    });

    const finalUrl = page.url();
    const status = response?.status();
    console.log("[AUTH-DIAG] Final URL:", finalUrl);
    console.log("[AUTH-DIAG] Response status:", status);
    console.log("[AUTH-DIAG] Redirected to login:", finalUrl.includes("/sign-in") || finalUrl.includes("/login"));

    // Step 5: Check page content
    const h1Text = await page.locator("h1").first().textContent().catch(() => "NO_H1");
    console.log("[AUTH-DIAG] H1 text:", h1Text);

    // The actual assertion — must be on portfolio page, not login/error
    expect(finalUrl).toMatch(/\/dashboard\/portfolio/);
    expect(h1Text).toMatch(/portfolio/i);
  });
});