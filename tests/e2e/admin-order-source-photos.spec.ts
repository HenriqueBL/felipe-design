import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { createTestUser, deleteTestUser, createFreshAdminClient } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { getOrCreateTestPlan, cleanupUserData } from "./helpers/fixtures";

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/tiny.jpg");

interface IntakeLimits {
  requiredPerKnife: number;
  maxPerKnife: number;
}

/** Read real intake limits from the order snapshot — never hardcode 3/5. */
async function readIntakeLimits(orderId: string): Promise<IntakeLimits> {
  const admin = createFreshAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select("required_source_photos_per_knife, max_source_photos_per_knife")
    .eq("id", orderId)
    .single();
  if (error || !data) {
    throw new Error(`ADMIN DETAIL E2E: failed to read order ${orderId}: ${error?.message}`);
  }
  return {
    requiredPerKnife: data.required_source_photos_per_knife,
    maxPerKnife: data.max_source_photos_per_knife,
  };
}

test.describe("Admin Order Detail — source photo grouping (2 knives)", () => {
  let customer: { userId: string; email: string; password: string };
  let admin: { userId: string; email: string; password: string };
  let planId: string;

  test.beforeAll(async () => {
    customer = await createTestUser("admin-detail", "user");
    admin = await createTestUser("admin-detail-admin", "admin");
    planId = (await getOrCreateTestPlan()).id;
  });

  test.afterAll(async () => {
    if (customer?.userId) {
      await cleanupUserData(customer.userId);
      await deleteTestUser(customer.userId).catch(() => {});
    }
    if (admin?.userId) {
      await cleanupUserData(admin.userId);
      await deleteTestUser(admin.userId).catch(() => {});
    }
  });

  test("admin detail: photos grouped per knife, snapshot metadata, private thumbnails", async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    // ── Create a 2-knife order as the customer ──
    await authenticateWithSSR(page, customer.email, customer.password);
    await page.goto(`/en/checkout?plan=${planId}&qty=2&currency=USD&key=${randomUUID()}`);
    const createBtn = page.locator("main").getByRole("button", { name: /create order/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await expect(page).toHaveURL(/\/en\/account\/(orders|pedidos)\//, { timeout: 15_000 });

    const orderIdMatch = page.url().match(/(?:pedidos|orders)\/([0-9a-f-]+)/);
    if (!orderIdMatch) throw new Error("ADMIN DETAIL E2E: orderId not found in URL");
    const orderId = orderIdMatch[1]!;

    const { requiredPerKnife, maxPerKnife } = await readIntakeLimits(orderId);

    // ── Mock payment, then reload ──
    const payBtn = page.locator('button:has-text("Simulate payment")');
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await payBtn.click();
    await expect(page.locator(".badge.awaiting_photos")).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // ── Upload min photos for each knife ──
    const knifeSections = page.locator(".source-photo-knife");
    await expect(knifeSections).toHaveCount(2, { timeout: 10_000 });

    for (let k = 1; k <= 2; k++) {
      const section = knifeSections.nth(k - 1);
      const heading = section.locator("h4, h3").first();
      const files: string[] = [];
      for (let i = 0; i < requiredPerKnife; i++) files.push(FIXTURE_IMAGE);
      await section.locator('input[type="file"]').setInputFiles(files);
      // The finish button only enables when every job COMPLETES; the item
      // count alone is optimistic. Wait for the counter to reach the minimum.
      await expect
        .poll(
          async () =>
            heading
              .textContent()
              .then((t) => Number((t ?? "").match(/(\d+)\s*\/\s*\d+/)?.[1] ?? "0")),
          { timeout: 90_000 },
        )
        .toBe(requiredPerKnife);
      await expect
        .poll(async () => section.locator(".source-photo-item").count(), { timeout: 60_000 })
        .toBe(requiredPerKnife);
    }

    // ── Finish intake (accept confirm dialog) ──
    let dialogMessage = "";
    page.once("dialog", (dialog) => {
      dialogMessage = dialog.message();
      void dialog.accept();
    });
    const finishBtn = page.locator('button:has-text("Finish photo submission")');
    await expect(finishBtn).toBeEnabled();
    await finishBtn.click();
    expect(dialogMessage).toContain("won't be able");
    await expect(page.locator('text="Photos submitted"')).toBeVisible({ timeout: 30_000 });

    await ctx.close();

    // ── Admin views the order detail ──
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const adminPage = await adminCtx.newPage();
    await authenticateWithSSR(adminPage, admin.email, admin.password);
    await adminPage.goto(`/en/dashboard/orders/${orderId}`);
    await adminPage.waitForLoadState("networkidle");

    // ── Knife groups exist ──
    const knifeGroup = (n: number) =>
      adminPage.locator("main .source-photo-knife").filter({ hasText: `Knife ${n}` });
    await expect(knifeGroup(1)).toBeVisible({ timeout: 15_000 });
    await expect(knifeGroup(2)).toBeVisible({ timeout: 15_000 });

    // ── Count per knife + snapshot min/max in the heading ──
    for (const k of [1, 2]) {
      await expect(knifeGroup(k).locator("h3, h4").first()).toContainText(
        `${requiredPerKnife} of ${requiredPerKnife}–${maxPerKnife} expected`,
      );
      await expect(knifeGroup(k).locator("img.source-photo-thumb")).toHaveCount(requiredPerKnife);
    }

    // ── Knife isolation: total across groups equals 2x min, no cross-mixing ──
    const total = await adminPage
      .locator(".source-photo-knife img.source-photo-thumb")
      .count();
    expect(total).toBe(2 * requiredPerKnife);

    // ── submitted status + timestamp ──
    const photosPanel = adminPage.locator(".panel").filter({ hasText: "Source photos" });
    await expect(photosPanel.locator(".note").first()).toContainText(/Submitted at/);

    // ── Thumbnails load from signed URLs (private bucket) ──
    const thumbs = adminPage.locator("img.source-photo-thumb");
    const thumbCount = await thumbs.count();
    // Force eager loading so lazy-loading does not mask the real fetches.
    // Reassign src unconditionally: a lazily-skipped image can report
    // complete=true with naturalWidth=0 (no fetch ever issued).
    await adminPage.evaluate(() => {
      document.querySelectorAll("img.source-photo-thumb").forEach((el) => {
        const img = el as HTMLImageElement;
        img.loading = "eager";
        img.scrollIntoView({ block: "center" });
        img.src = img.getAttribute("src") ?? "";
      });
    });
    for (let i = 0; i < thumbCount; i++) {
      const src = await thumbs.nth(i).getAttribute("src");
      expect(src).toContain("token=");
      // The signed URL must actually serve the private object.
      const res = await adminPage.request.get(src!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"] ?? "").toContain("image/");
      await expect
        .poll(
          async () =>
            thumbs.nth(i).evaluate(
              (img) =>
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0,
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
    }

    // ── Source photos are NOT mixed with result/final images ──
    // No results uploaded: the result panel contains no images.
    const resultPanel = adminPage.locator(".panel").filter({ hasText: "Upload final results" });
    await expect(resultPanel.locator("img")).toHaveCount(0);
    // All thumbnails live inside .source-photo-knife groups (no orphans).
    const orphanThumbs = await adminPage
      .locator("img.source-photo-thumb:not(.source-photo-knife img.source-photo-thumb)")
      .count();
    expect(orphanThumbs).toBe(0);

    await adminCtx.close();
  });
});
