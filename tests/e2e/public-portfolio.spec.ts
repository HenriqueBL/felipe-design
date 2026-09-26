import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, getAdminClient } from "./helpers/auth";
import { authenticateWithSSR } from "./helpers/ssr-auth";
import { cleanupUserData } from "./helpers/fixtures";

test.describe("Public Portfolio (Phase 3)", () => {
  let adminUserId: string;
  let adminEmail: string;
  let adminPassword: string;
  const createdWorkIds: string[] = [];

  test.beforeAll(async () => {
    const user = await createTestUser("pub-portfolio-admin", "admin");
    adminUserId = user.userId;
    adminEmail = user.email;
    adminPassword = user.password;
  });

  // Re-authenticate before each test to ensure session cookies are valid.
  test.beforeEach(async ({ page }) => {
    await authenticateWithSSR(page, adminEmail, adminPassword);
    await page.setExtraHTTPHeaders({ "x-test-country": "US" });
  });

  test.afterAll(async () => {
    if (adminUserId) {
      const admin = getAdminClient();
      for (const workId of createdWorkIds) {
        try {
          const { data: media } = await admin
            .from("portfolio_item_media")
            .select("storage_path")
            .eq("portfolio_item_id", workId);
          if (media && media.length > 0) {
            const paths = media.map((m) => m.storage_path);
            await admin.storage.from("portfolio").remove(paths);
          }
          await admin.from("portfolio_items").delete().eq("id", workId);
        } catch {
          // best-effort cleanup
        }
      }
      await cleanupUserData(adminUserId).catch(() => {});
      await deleteTestUser(adminUserId).catch(() => {});
    }
  });

  /** Generate a valid JPEG image buffer of given dimensions */
  async function generateImageBuffer(
    page: import("@playwright/test").Page,
    width: number,
    height: number,
  ): Promise<Buffer> {
    const fileBuffer = await page.evaluate(
      ({ w, h }) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, "#ff6b6b");
        grad.addColorStop(0.5, "#4ecdc4");
        grad.addColorStop(1, "#556270");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        const dataUrl = c.toDataURL("image/jpeg", 0.95);
        const base64 = dataUrl.split(",")[1] ?? "";
        const bin = atob(base64);
        const arr = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
        return Array.from(arr);
      },
      { w: width, h: height },
    );
    return Buffer.from(fileBuffer);
  }

  /** Create a published work with N media via the CMS UI flow */
  async function createWorkWithMedia(
    page: import("@playwright/test").Page,
    adminClient: ReturnType<typeof getAdminClient>,
    title: string,
    mediaSpecs: Array<{ w: number; h: number }>,
    featured = false,
  ): Promise<string> {
    await page.goto("/en/dashboard/portfolio?create=1");
    await expect(page.locator("#cms-title")).toBeVisible({ timeout: 15_000 });
    await page.fill("#cms-title", title);

    const firstBuf = await generateImageBuffer(page, mediaSpecs[0]!.w, mediaSpecs[0]!.h);
    const createInput = page.locator('input[type="file"]').first();
    await expect(createInput).toBeVisible({ timeout: 10_000 });
    await createInput.setInputFiles({
      name: `media-1-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
      buffer: firstBuf,
    });

    await page.locator('button[type="submit"].btn-primary').first().click();
    await expect(page).toHaveURL(/\/dashboard\/portfolio\?edit=/, { timeout: 15_000 });
    const workId = new URL(page.url()).searchParams.get("edit")!;
    expect(workId).toBeTruthy();
    createdWorkIds.push(workId);

    for (let i = 1; i < mediaSpecs.length; i++) {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      const buf = await generateImageBuffer(page, mediaSpecs[i]!.w, mediaSpecs[i]!.h);
      const fileInput = page.locator('[data-testid="add-media-hidden-input"]');
      await expect(fileInput).toBeAttached({ timeout: 15_000 });
      await fileInput.setInputFiles({
        name: `media-${i + 1}-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        buffer: buf,
      });
      await expect(async () => {
        const { count } = await adminClient
          .from("portfolio_item_media")
          .select("id", { count: "exact", head: true })
          .eq("portfolio_item_id", workId);
        expect(count).toBe(i + 1);
      }).toPass({ timeout: 30_000 });
    }

    await adminClient
      .from("portfolio_items")
      .update({ published: true, featured })
      .eq("id", workId);

    await expect(async () => {
      const { data } = await adminClient
        .from("portfolio_items")
        .select("published, featured")
        .eq("id", workId)
        .single();
      expect(data?.published).toBe(true);
      if (featured) expect(data?.featured).toBe(true);
    }).toPass({ timeout: 10_000 });

    return workId;
  }

  /** Assert that the first media row for a work has exact DB dimensions */
  async function assertMediaDimensions(
    adminClient: ReturnType<typeof getAdminClient>,
    workId: string,
    expectedWidth: number,
    expectedHeight: number,
  ) {
    const { data: media } = await adminClient
      .from("portfolio_item_media")
      .select("width, height")
      .eq("portfolio_item_id", workId)
      .order("position", { ascending: true })
      .limit(1)
      .single();
    expect(media).not.toBeNull();
    expect(media!.width).toBe(expectedWidth);
    expect(media!.height).toBe(expectedHeight);
  }

  /** Clear all featured works */
  async function clearAllFeatured(adminClient: ReturnType<typeof getAdminClient>) {
    const { data: existing } = await adminClient
      .from("portfolio_items")
      .select("id")
      .eq("featured", true);
    for (const w of existing ?? []) {
      await adminClient.from("portfolio_items").update({ featured: false }).eq("id", w.id);
    }
  }

  test("gallery renders 1/2/3 media works with correct geometry", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await createWorkWithMedia(page, adminClient, "Pub Test 1 Media", [{ w: 1200, h: 800 }]);
    await createWorkWithMedia(page, adminClient, "Pub Test 2 Media", [
      { w: 1200, h: 800 },
      { w: 800, h: 1200 },
    ]);
    await createWorkWithMedia(page, adminClient, "Pub Test 3 Media", [
      { w: 1600, h: 900 },
      { w: 900, h: 1200 },
      { w: 1000, h: 1000 },
    ]);

    await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });

    const workArticles = page.locator("article.gallery-work");
    await expect(workArticles.filter({ hasText: "Pub Test 1 Media" })).toBeVisible({ timeout: 15_000 });
    await expect(workArticles.filter({ hasText: "Pub Test 2 Media" })).toBeVisible({ timeout: 15_000 });
    await expect(workArticles.filter({ hasText: "Pub Test 3 Media" })).toBeVisible({ timeout: 15_000 });

    const threeMediaArticle = workArticles.filter({ hasText: "Pub Test 3 Media" });
    await expect(threeMediaArticle).toBeVisible({ timeout: 10_000 });

    const angles = threeMediaArticle.locator(".gallery-work-angle");
    await expect(angles).toHaveCount(3, { timeout: 10_000 });

    await angles.nth(0).scrollIntoViewIfNeeded();
    await angles.nth(2).scrollIntoViewIfNeeded();

    const box1 = await angles.nth(0).boundingBox();
    const box2 = await angles.nth(1).boundingBox();
    const box3 = await angles.nth(2).boundingBox();

    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    expect(box3).not.toBeNull();

    const widthDiff = Math.abs(box2!.width - box3!.width);
    const heightDiff = Math.abs(box2!.height - box3!.height);
    expect(widthDiff).toBeLessThanOrEqual(2);
    expect(heightDiff).toBeLessThanOrEqual(2);

    const area1 = box1!.width * box1!.height;
    const area2 = box2!.width * box2!.height;
    const area3 = box3!.width * box3!.height;
    expect(area1).toBeGreaterThan(area2);
    expect(area1).toBeGreaterThan(area3);

    const galleryImages = page.locator(".gallery-work-img, .gallery-work-img-contain");
    const imgCount = await galleryImages.count();
    expect(imgCount).toBeGreaterThanOrEqual(6);

    for (let i = 0; i < Math.min(imgCount, 6); i++) {
      await galleryImages.nth(i).scrollIntoViewIfNeeded();
      const fit = await galleryImages.nth(i).evaluate((el) => {
        return window.getComputedStyle(el).objectFit;
      });
      expect(fit).toBe("contain");
    }
  });

  test("gallery stacks vertically on mobile without overflow", async ({ page }) => {
    test.setTimeout(120_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    const existingWorks = await adminClient
      .from("portfolio_items")
      .select("id, title")
      .eq("published", true)
      .limit(5);

    let hasThreeMedia = false;
    for (const w of existingWorks.data ?? []) {
      const { count } = await adminClient
        .from("portfolio_item_media")
        .select("id", { count: "exact", head: true })
        .eq("portfolio_item_id", w.id);
      if ((count ?? 0) >= 3) {
        hasThreeMedia = true;
        break;
      }
    }

    if (!hasThreeMedia) {
      await createWorkWithMedia(page, adminClient, "Mobile Test 3 Media", [
        { w: 1600, h: 900 },
        { w: 900, h: 1200 },
        { w: 1000, h: 1000 },
      ]);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(390);

    const threeMediaArticle = page.locator("article.gallery-work").filter({ hasText: /3 Media|Mobile Test/ }).first();
    if ((await threeMediaArticle.count()) > 0) {
      const angles = threeMediaArticle.locator(".gallery-work-angle");
      const count = await angles.count();
      if (count >= 3) {
        const box1 = await angles.nth(0).boundingBox();
        const box2 = await angles.nth(1).boundingBox();
        const box3 = await angles.nth(2).boundingBox();

        expect(box1).not.toBeNull();
        expect(box2).not.toBeNull();
        expect(box3).not.toBeNull();
        expect(box2!.y).toBeGreaterThan(box1!.y);
        expect(box3!.y).toBeGreaterThan(box2!.y);

        expect(box1!.x + box1!.width).toBeLessThanOrEqual(390);
        expect(box2!.x + box2!.width).toBeLessThanOrEqual(390);
        expect(box3!.x + box3!.width).toBeLessThanOrEqual(390);
      }
    }

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("home hero landscape — DB dimensions persisted, cover mode, focal point", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await clearAllFeatured(adminClient);

    const landscapeId = await createWorkWithMedia(
      page, adminClient, "Hero Landscape Strict", [{ w: 1920, h: 1080 }], true,
    );

    // GAP 2: Require DB dimensions are persisted before checking rendering
    await assertMediaDimensions(adminClient, landscapeId, 1920, 1080);

    // Set deterministic focal point
    await adminClient
      .from("portfolio_items")
      .update({ focal_point: "bottom-right" })
      .eq("id", landscapeId);

    await page.goto("/en", { waitUntil: "networkidle", timeout: 30_000 });

    const heroSection = page.locator(".cinematic-hero");
    await expect(heroSection).toBeVisible({ timeout: 15_000 });

    // Must have landscape class
    const heroClass = await heroSection.getAttribute("class");
    expect(heroClass).toContain("cinematic-hero--landscape");

    // Image must use object-fit: cover
    const heroImg = heroSection.locator("img").first();
    await expect(heroImg).toBeVisible({ timeout: 10_000 });
    const objectFit = await heroImg.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(objectFit).toBe("cover");

    // Focal point must map to canonical object-position
    // bottom-right → "right bottom" per focalPointToObjectPosition()
    // Chromium normalizes keyword positions to percentages (e.g. "right bottom" → "100% 100%")
    const objectPosition = await heroImg.evaluate((el) => window.getComputedStyle(el).objectPosition);
    const normalizedPosition = objectPosition.replace(/\s+/g, " ").trim();
    expect(["right bottom", "100% 100%"]).toContain(normalizedPosition);

    // Must not be the fallback
    const heroSrc = await heroImg.getAttribute("src");
    expect(heroSrc).not.toBe("/home/hero-fallback.svg");
    expect(heroSrc).toMatch(/portfolio|_next\/image/);
  });

  test("home hero portrait — DB dimensions persisted, editorial contain", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await clearAllFeatured(adminClient);

    const portraitId = await createWorkWithMedia(
      page, adminClient, "Hero Portrait Strict", [{ w: 900, h: 1400 }], true,
    );

    // GAP 2: Require DB dimensions
    await assertMediaDimensions(adminClient, portraitId, 900, 1400);

    await page.goto("/en", { waitUntil: "networkidle", timeout: 30_000 });

    const heroSection = page.locator(".cinematic-hero");
    await expect(heroSection).toBeVisible({ timeout: 15_000 });

    const heroClass = await heroSection.getAttribute("class");
    expect(heroClass).toContain("cinematic-hero--editorial");

    const heroImg = heroSection.locator("img").first();
    await expect(heroImg).toBeVisible({ timeout: 10_000 });
    const objectFit = await heroImg.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(objectFit).toBe("contain");
  });

  test("home hero square — DB dimensions persisted, editorial contain", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await clearAllFeatured(adminClient);

    const squareId = await createWorkWithMedia(
      page, adminClient, "Hero Square Strict", [{ w: 1000, h: 1000 }], true,
    );

    // GAP 2: Require DB dimensions
    await assertMediaDimensions(adminClient, squareId, 1000, 1000);

    await page.goto("/en", { waitUntil: "networkidle", timeout: 30_000 });

    const heroSection = page.locator(".cinematic-hero");
    await expect(heroSection).toBeVisible({ timeout: 15_000 });

    const heroClass = await heroSection.getAttribute("class");
    expect(heroClass).toContain("cinematic-hero--editorial");

    const heroImg = heroSection.locator("img").first();
    await expect(heroImg).toBeVisible({ timeout: 10_000 });
    const objectFit = await heroImg.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(objectFit).toBe("contain");
  });

  test("home hero unknown — deliberate null dimensions, editorial contain fallback", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await clearAllFeatured(adminClient);

    // Create a valid work with real dimensions first
    const unknownId = await createWorkWithMedia(
      page, adminClient, "Hero Unknown Deliberate", [{ w: 1200, h: 800 }], true,
    );

    // Deliberately nullify dimensions via admin client to simulate unknown
    await adminClient
      .from("portfolio_item_media")
      .update({ width: null, height: null })
      .eq("portfolio_item_id", unknownId);

    // Verify dimensions are actually null in DB
    const { data: mediaRow } = await adminClient
      .from("portfolio_item_media")
      .select("width, height")
      .eq("portfolio_item_id", unknownId)
      .limit(1)
      .single();
    expect(mediaRow?.width).toBeNull();
    expect(mediaRow?.height).toBeNull();

    await page.goto("/en", { waitUntil: "networkidle", timeout: 30_000 });

    const heroSection = page.locator(".cinematic-hero");
    await expect(heroSection).toBeVisible({ timeout: 15_000 });

    // Unknown must render editorial mode, NOT landscape cover
    const heroClass = await heroSection.getAttribute("class");
    expect(heroClass).toContain("cinematic-hero--editorial");
    expect(heroClass).not.toContain("cinematic-hero--landscape");

    const heroImg = heroSection.locator("img").first();
    await expect(heroImg).toBeVisible({ timeout: 10_000 });
    const objectFit = await heroImg.evaluate((el) => window.getComputedStyle(el).objectFit);
    expect(objectFit).toBe("contain");
  });

  test("home hero fallback when no featured work exists", async ({ page }) => {
    test.setTimeout(120_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await clearAllFeatured(adminClient);

    await page.goto("/en", { waitUntil: "networkidle", timeout: 30_000 });

    // When no featured work exists, hero should show the safe fallback SVG
    const fallbackImg = page.locator("img[src='/home/hero-fallback.svg']");
    await expect(fallbackImg).toBeVisible({ timeout: 15_000 });
  });

  test("hero adaptive layout across viewports 1440/1100/900/390", async ({ page }) => {
    test.setTimeout(180_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await clearAllFeatured(adminClient);

    // Create a landscape hero for viewport testing
    await createWorkWithMedia(
      page, adminClient, "Hero Viewport Test", [{ w: 1920, h: 1080 }], true,
    );

    const viewports = [
      { width: 1440, height: 900 },
      { width: 1100, height: 800 },
      { width: 900, height: 700 },
      { width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/en", { waitUntil: "networkidle", timeout: 30_000 });

      const heroSection = page.locator(".cinematic-hero");
      await expect(heroSection).toBeVisible({ timeout: 15_000 });

      // Hero must stay within viewport — no horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width);

      // Hero section must have non-zero rendered size
      const heroBox = await heroSection.boundingBox();
      expect(heroBox).not.toBeNull();
      expect(heroBox!.width).toBeGreaterThan(0);
      expect(heroBox!.height).toBeGreaterThan(0);

      // Hero image must be visible
      const heroImg = heroSection.locator("img").first();
      await expect(heroImg).toBeVisible({ timeout: 10_000 });
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("gallery geometry at viewports 1440/1100/900/390", async ({ page }) => {
    test.setTimeout(240_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    // Ensure a 3-media work exists for geometry testing
    const existingWorks = await adminClient
      .from("portfolio_items")
      .select("id")
      .eq("published", true)
      .limit(10);

    let hasThreeMedia = false;
    for (const w of existingWorks.data ?? []) {
      const { count } = await adminClient
        .from("portfolio_item_media")
        .select("id", { count: "exact", head: true })
        .eq("portfolio_item_id", w.id);
      if ((count ?? 0) >= 3) {
        hasThreeMedia = true;
        break;
      }
    }

    if (!hasThreeMedia) {
      await createWorkWithMedia(page, adminClient, "Viewport Geo 3 Media", [
        { w: 1600, h: 900 },
        { w: 900, h: 1200 },
        { w: 1000, h: 1000 },
      ]);
    }

    // Desktop viewports: 1440 and 1100 should show 3-media desktop geometry
    for (const vp of [{ width: 1440, height: 900 }, { width: 1100, height: 800 }]) {
      await page.setViewportSize(vp);
      await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });

      const threeMediaArticle = page.locator("article.gallery-work").filter({ hasText: /3 Media|Viewport Geo/ }).first();
      if ((await threeMediaArticle.count()) > 0) {
        const angles = threeMediaArticle.locator(".gallery-work-angle");
        const angleCount = await angles.count();
        if (angleCount >= 3) {
          await angles.nth(0).scrollIntoViewIfNeeded();
          await angles.nth(2).scrollIntoViewIfNeeded();

          const box1 = await angles.nth(0).boundingBox();
          const box2 = await angles.nth(1).boundingBox();
          const box3 = await angles.nth(2).boundingBox();

          expect(box1).not.toBeNull();
          expect(box2).not.toBeNull();
          expect(box3).not.toBeNull();

          // Angle 1 area > Angle 2 and 3
          const area1 = box1!.width * box1!.height;
          const area2 = box2!.width * box2!.height;
          const area3 = box3!.width * box3!.height;
          expect(area1).toBeGreaterThan(area2);
          expect(area1).toBeGreaterThan(area3);

          // Angle 2 and 3 equal within 2px
          expect(Math.abs(box2!.width - box3!.width)).toBeLessThanOrEqual(2);
          expect(Math.abs(box2!.height - box3!.height)).toBeLessThanOrEqual(2);
        }
      }

      // No horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width);
    }

    // 900px: verify responsive breakpoint behavior, no overflow
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });
    {
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(900);

      const workArticles = page.locator("article.gallery-work");
      const count = await workArticles.count();
      expect(count).toBeGreaterThan(0);
    }

    // 390px: stack vertically, no overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });
    {
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(390);

      const threeMediaArticle = page.locator("article.gallery-work").filter({ hasText: /3 Media|Viewport Geo/ }).first();
      if ((await threeMediaArticle.count()) > 0) {
        const angles = threeMediaArticle.locator(".gallery-work-angle");
        const angleCount = await angles.count();
        if (angleCount >= 3) {
          const box1 = await angles.nth(0).boundingBox();
          const box2 = await angles.nth(1).boundingBox();
          const box3 = await angles.nth(2).boundingBox();

          expect(box1).not.toBeNull();
          expect(box2).not.toBeNull();
          expect(box3).not.toBeNull();
          // Stacked: y1 < y2 < y3
          expect(box2!.y).toBeGreaterThan(box1!.y);
          expect(box3!.y).toBeGreaterThan(box2!.y);
        }
      }
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("public rendering works without legacy storage fields", async ({ page }) => {
    test.setTimeout(120_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    const workId = await createWorkWithMedia(page, adminClient, "Legacy Null Test", [
      { w: 1200, h: 800 },
    ]);

    const { data: workRow } = await adminClient
      .from("portfolio_items")
      .select("image_storage_path, before_storage_path, after_storage_path")
      .eq("id", workId)
      .single();
    expect(workRow?.image_storage_path).toBeNull();
    expect(workRow?.before_storage_path).toBeNull();
    expect(workRow?.after_storage_path).toBeNull();

    const { count } = await adminClient
      .from("portfolio_item_media")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_item_id", workId);
    expect(count).toBe(1);

    await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });

    const workArticle = page.locator("article.gallery-work").filter({ hasText: "Legacy Null Test" });
    await expect(workArticle).toBeVisible({ timeout: 15_000 });

    const img = workArticle.locator("img").first();
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible({ timeout: 10_000 });

    const src = await img.getAttribute("src");
    expect(src).toMatch(/portfolio/);
    expect(src).not.toContain("before_storage_path");
    expect(src).not.toContain("after_storage_path");
    expect(src).not.toContain("image_storage_path");
  });

  test("draft works are never exposed publicly", async ({ page }) => {
    test.setTimeout(120_000);
    await authenticateWithSSR(page, adminEmail, adminPassword);
    const adminClient = getAdminClient();

    await page.goto("/en/dashboard/portfolio?create=1");
    await expect(page.locator("#cms-title")).toBeVisible({ timeout: 15_000 });
    await page.fill("#cms-title", "Draft Work Secret");

    const buf = await generateImageBuffer(page, 1200, 800);
    const createInput = page.locator('input[type="file"]').first();
    await expect(createInput).toBeVisible({ timeout: 10_000 });
    await createInput.setInputFiles({
      name: `draft-${Date.now()}.jpg`,
      mimeType: "image/jpeg",
      buffer: buf,
    });

    await page.locator('button[type="submit"].btn-primary').first().click();
    await expect(page).toHaveURL(/\/dashboard\/portfolio\?edit=/, { timeout: 15_000 });
    const draftId = new URL(page.url()).searchParams.get("edit")!;
    createdWorkIds.push(draftId);

    await adminClient.from("portfolio_items").update({ published: false }).eq("id", draftId);

    await page.goto("/en/gallery", { waitUntil: "networkidle", timeout: 30_000 });

    const draftArticle = page.locator("article.gallery-work").filter({ hasText: "Draft Work Secret" });
    await expect(draftArticle).toHaveCount(0, { timeout: 10_000 });
  });
});