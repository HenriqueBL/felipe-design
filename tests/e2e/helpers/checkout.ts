/**
 * E2E Checkout Helpers — fixture creation and cart-flow navigation.
 *
 * These helpers encapsulate the two checkout entry points:
 * 1. Single-item checkout (?plan=...&qty=...&currency=...&key=...) — used by
 *    specs that need a quick order fixture without exercising the cart UI.
 * 2. Cart checkout (?cart=1) — used by customer-journey specs that must
 *    validate the real Services → Add to cart → Cart → Checkout flow.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

import type { Currency } from "@/types/database";

export interface SingleItemCheckoutParams {
  planId: string;
  quantity?: number;
  currency?: Currency;
  idempotencyKey?: string;
}

/**
 * Build a single-item checkout URL with all required query parameters.
 * The checkout page renders "invalid selection" without these params.
 */
export function buildSingleItemCheckoutUrl(
  locale: "en" | "pt",
  params: SingleItemCheckoutParams,
): string {
  const base = locale === "en" ? "/en/checkout" : "/pt/finalizar";
  const query = new URLSearchParams({
    plan: params.planId,
    qty: String(params.quantity ?? 1),
    currency: params.currency ?? (locale === "en" ? "USD" : "BRL"),
    key: params.idempotencyKey ?? randomUUID(),
  });
  return `${base}?${query.toString()}`;
}

/**
 * Extract the first active plan ID from the services page.
 * Reads the `data-plan-id` attribute from the first plan article.
 * Requires the services page to already be loaded.
 */
export async function getFirstPlanId(page: Page): Promise<string> {
  const article = page.locator("article[data-plan-id]").first();
  await expect(article).toBeVisible({ timeout: 10_000 });
  const planId = await article.getAttribute("data-plan-id");
  if (!planId) {
    throw new Error("First plan article has no data-plan-id attribute");
  }
  return planId;
}

/**
 * Navigate to single-item checkout for the first available plan.
 * Returns the constructed checkout URL for assertions.
 */
export async function navigateToSingleItemCheckout(
  page: Page,
  locale: "en" | "pt" = "en",
  overrides?: Partial<SingleItemCheckoutParams>,
): Promise<string> {
  await page.goto(`/${locale}/services`);
  const planId = await getFirstPlanId(page);
  const url = buildSingleItemCheckoutUrl(locale, {
    planId,
    ...overrides,
  });
  await page.goto(url);
  await expect(page).toHaveURL(/\/checkout\?plan=|\/finalizar\?plan=/);
  return url;
}

/**
 * Add the first plan to cart via the services page UI.
 * Clicks "Add to cart" and waits for confirmation.
 * Does NOT navigate to cart or checkout — caller decides next step.
 */
export async function addFirstPlanToCartViaUI(
  page: Page,
  locale: "en" | "pt" = "en",
): Promise<void> {
  await page.goto(`/${locale}/services`);
  const addToCartBtn = page
    .locator("article[data-plan-id]")
    .first()
    .getByRole("button", { name: /add to cart|adicionar ao carrinho/i });
  await expect(addToCartBtn).toBeVisible({ timeout: 10_000 });
  await addToCartBtn.click();
  // Confirm add-to-cart succeeded by waiting for the semantic "View cart" link
  // that appears only after a successful add. No visual CSS selectors needed.
  await expect(
    page.getByRole("link", { name: /view cart|ver carrinho/i }),
  ).toBeVisible({ timeout: 5_000 });
}

/**
 * Navigate through the full cart checkout flow:
 * Services → Add to cart → View cart → Checkout (?cart=1)
 *
 * This exercises the real user journey and validates each step.
 */
export async function navigateCartCheckoutFlow(
  page: Page,
  locale: "en" | "pt" = "en",
): Promise<void> {
  // Step 1: Services — add first plan to cart
  await addFirstPlanToCartViaUI(page, locale);

  // Step 2: Navigate to cart via the "View cart" link in confirmation
  const viewCartLink = page.getByRole("link", {
    name: /view cart|ver carrinho/i,
  });
  await expect(viewCartLink).toBeVisible({ timeout: 5_000 });
  await viewCartLink.click();

  const cartPath = locale === "en" ? "/en/cart" : "/pt/carrinho";
  await expect(page).toHaveURL(new RegExp(cartPath.replace("/", "\\/")));

  // Step 3: Verify cart has items
  await expect(page.locator("main")).toContainText(/cart|carrinho|item/i);

  // Step 4: Click checkout button in cart
  const checkoutBtn = page.getByRole("link", {
    name: /checkout|finalizar compra/i,
  });
  await expect(checkoutBtn).toBeVisible({ timeout: 10_000 });
  await checkoutBtn.click();

  // Step 5: Verify we're on cart checkout
  const checkoutBase = locale === "en" ? "/en/checkout" : "/pt/finalizar";
  await expect(page).toHaveURL(
    new RegExp(`${checkoutBase.replace("/", "\\/")}\\?cart=1`),
  );
}