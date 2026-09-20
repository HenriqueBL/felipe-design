# Multi-Item Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer buy multiple plan/angle configurations in one order via a shopping cart, while the server remains the sole authority for prices, totals, image counts, and deadlines.

**Architecture:** Additive migration `0017` introduces `order_items` (one row per plan × knife-quantity, with a global knife index range `knife_index_start .. knife_index_start + knife_quantity - 1`) and a new `create_cart_order(p_items jsonb, ...)` RPC; legacy `orders` columns become aggregate snapshots populated for every order (legacy orders backfilled with a single item). Frontend gets a localStorage cart holding only intent (`planId`, `quantity`, `currency`), `/cart` pages, and a checkout that revalidates prices server-side before calling the RPC.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (Postgres RPCs, RLS, TUS uploads), Vitest, Playwright.

**Spec:** This plan is driven by the user's task brief (cart + multi-item orders + preserved queue/uploads/payments authority), the SQL audit (migrations 0001–0016), and the TS audit (src/domain, src/services, src/app).

## Global Constraints

- Never trust browser-computed prices, totals, or image counts; server RPC is the only authority.
- One order = one currency. Never auto-convert BRL ↔ USD.
- Migrations additive; legacy orders must remain visible, uploadable, payable, and admin-renderable.
- No Stripe configuration changes; payment amount flows from `orders.total_cents`.
- EN/PT i18n parity for every new string (add to `en.ts`, mirror in `pt.ts`, type-checked via `Dictionary`).
- `npm run lint` and `npm run typecheck` must pass with zero errors; no `any`.
- Files: components PascalCase, files kebab-case, 2-space indent, max 100 chars.
- Queue workload unit = output images (`total_images`), never source photos.
- No deploy, no PROD migration. DEV ref: `jfsymthtepikfpexzxvk` (confirm before any push).

## Key design decisions (from audit)

1. **`order_items` with global knife index range.** Each item row: `order_id, item_index (1..n), plan_id, knife_quantity, angles (snapshot), unit_price_cents, subtotal_cents, total_images, knife_index_start (int not null)`. The physical knives of item i are `knife_index_start .. knife_index_start + knife_quantity - 1` in a global 1..`orders.total_knives` namespace. `order_images.knife_index` stays a single unambiguous global index. This beats normalizing an `order_knives` table (YAGNI: knives of one item are identical; per-knife policy is uniform per order snapshot) and beats per-item indexing (would require composite (item_index, knife_index) on order_images and a rewrite of intake).
2. **Orders keeps aggregate snapshot columns** (`unit_price_cents` = first item's unit price for display, `subtotal_cents` = `total_cents` = sum of item subtotals, `total_images` = sum of item images, `knife_quantity` = total knives). Drop the two legacy check constraints `orders_subtotal_matches`/`orders_total_matches` (they encode one-price-per-order; equality is now enforced in the RPC and backfill). Keep `plan_id` NOT NULL on legacy rows but make it **nullable + FK kept** for new multi-item orders where no single plan applies; new single-item orders still populate it. All readers fall back to `order_items`.
3. **New RPC `create_cart_order`**; `create_order` (legacy signature) left untouched so old flows/tests keep working. New RPC: auth, validate items (max 20 distinct plan+qty lines, qty 1..100), lock-free settings read (same as current `create_order`), per-item plan active check + price snapshot, aggregates computed, single transaction, idempotency by `(idempotency_key, user_id)` with `unique_violation` retry-select (same pattern as 0008).
4. **Cart frontend = intent only.** `localStorage["felipe-cart"] = { currency: "BRL"|"USD", items: [{ planId, quantity }] }`. Adding the same planId merges quantities. Currency switch clears/revalidates the cart. Checkout page loads cart items, revalidates via `getActivePlanWithPrice` per item, computes nothing authoritative, submits `{ items, currency, idempotencyKey }` to a new server action calling `create_cart_order`.
5. **Source photo intake**: `register_source_image`, `delete_source_image`, `submit_source_photos`, `maybe_mark_order_ready` iterate items (falling back to the single legacy plan when no items). Knife index validated against the item range. Storage path stays `{userId}/{orderId}/knife-{global}/...`.

---

### Task 1: Migration 0017 — order_items, create_cart_order, backfill

**Files:**
- Create: `supabase/migrations/0017_multi_item_orders_and_cart.sql`
- Test: `tests/integration/cart-order-creation.test.ts` (schema + RPC behaviors)

**Interfaces (produced):**
- Table `public.order_items`: `id uuid pk default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade, item_index int not null, plan_id uuid not null references plans(id), knife_quantity int not null check between 1 and 100, angles smallint not null check between 1 and 3, unit_price_cents int not null check >= 0, subtotal_cents int not null check >= 0, total_images int not null check > 0, knife_index_start int not null check >= 1, created_at timestamptz not null default now()`; constraints `order_items_index_uq unique (order_id, item_index)`, `order_items_start_uq unique (order_id, knife_index_start)`, `order_items_subtotal_matches check (subtotal_cents = unit_price_cents * knife_quantity)`, `order_items_images_matches check (total_images = knife_quantity * angles)`; index `order_items_order_idx (order_id)`.
- RPC: `create_cart_order(p_items jsonb, p_currency public.currency, p_affiliate_code text default null, p_idempotency_key uuid default null) returns public.orders`, security definer set search_path = public, granted to authenticated + service_role, revoked from public/anon. `p_items` = `[{"plan_id": uuid, "quantity": int}, ...]` (1–20 entries).
- Backfill: for every existing order, insert one order_items row (`item_index 1, knife_index_start 1`, copying plan/knife/price/angles/total_images from the order). `orders.plan_id` becomes nullable via `alter table ... alter column plan_id drop not null` (FK kept).
- RLS on order_items: select via order owner-or-admin; no client insert/update/delete policies (all writes via SECURITY DEFINER RPC and backfill, run as owner).

- [ ] **Step 1: Write the migration SQL** (contents per the interface above; drop `orders_subtotal_matches` and `orders_total_matches`; `create_cart_order` follows the audited `create_order` 0008 pattern: auth check, idempotency pre-select, per-item validation loops, price snapshot from `plan_prices` active-in-window, aggregates, insert order + items, `unique_violation` handler re-selects by idempotency key, error codes `NOT_AUTHENTICATED, INVALID_ITEMS, PLAN_NOT_FOUND, PRICE_NOT_FOUND, IDEMPOTENCY_CONFLICT`).
- [ ] **Step 2: Dry-run syntax check** against DEV: show `supabase project list` ref (`jfsymthtepikfpexzxvk` expected) and `supabase db diff`/`db push --dry-run` output. Apply to DEV only after user-visible confirmation of the ref.
- [ ] **Step 3: Integration test** — creation multi-item (2 items), price snapshot immutability (change plan price after creation, order unchanged), inactive plan rejected, >20 items rejected, idempotency (same key returns same order), all-or-nothing (one invalid item → no order row), legacy order renders one item, RLS (owner sees own items, other user does not). Follow existing `tests/integration/payment-authority.test.ts` patterns for the Postgres harness.
- [ ] **Step 4: Run tests, commit** `feat: add order_items and create_cart_order migration`.

### Task 2: Database types + domain (cart model)

**Files:**
- Modify: `src/types/database.ts` (add `OrderItemRow`, table map, `create_cart_order` RPC signature)
- Create: `src/domain/cart.ts` (pure cart normalization + validation)
- Test: `tests/cart.test.ts`

**Interfaces:**
- `OrderItemRow` as per migration; `Database["public"]["Tables"]["order_items"]` with Row/Insert/Update.
- `src/domain/cart.ts`:
  - `cartSchema = z.object({ currency: z.enum(["BRL","USD"]), items: z.array(z.object({ planId: z.string().uuid(), quantity: z.number().int().min(1).max(100) })).min(1).max(20) })`
  - `normalizeCart(raw: unknown): Cart | null` — validates, merges duplicate planIds (sum quantities, cap 100), drops invalid entries; returns null if empty.
  - `cartOutputImages(cart, anglesByPlanId: Record<string, number>): number` (sum of `quantity * angles`).
  - `CART_STORAGE_KEY = "felipe-cart-v1"`.
- Update `src/domain/checkout.ts`: add `cartIntentSchema = z.object({ items: cartItemSchema, currency, idempotencyKey: z.string().uuid() })` and `parseCartIntent` for the checkout form; keep existing single-item schema untouched for compat.

- [ ] **Step 1: Write failing tests in `tests/cart.test.ts`** — merge duplicates, currency consistency, invalid planId dropped, empty → null, quantity clamp, images total, localStorage round-trip of `normalizeCart(JSON.parse(...))`.
- [ ] **Step 2: Run, verify fail; implement; verify pass. Commit** `feat: add cart domain model and order_items types`.

### Task 3: Services — createCartOrder + order detail reads items

**Files:**
- Modify: `src/services/order-creation.ts` (add `createCartOrder({ items, currency, affiliateCode?, idempotencyKey? }): Promise<OrderRow>` calling the new RPC, error mapping `OrderCreationError`)
- Modify: `src/services/customer-orders.ts`, `src/services/admin-orders.ts` — `getCustomerOrderDetail`/`getAdminOrderDetail` return `items: OrderItemRow[]` (select via order RLS, joined plan angles already snapshot in items; keep `planAngles` fallback for legacy rows without items — post-backfill this is always present, but keep code defensive).
- Test: extend unit tests with mocked RPC (follow `mock-payment-flow.test.ts` stubbing pattern).

- [ ] **Steps: failing test → implement → pass → commit** `feat: createCartOrder service and item-aware order details`.

### Task 4: Cart frontend (context, storage, header, /cart pages, services CTA)

**Files:**
- Create: `src/lib/cart-store.ts` ("use client" — localStorage read/write, subscribe via custom event, currency switch behavior)
- Create: `src/components/cart/cart-provider.tsx` (context; wraps app in `src/app/[locale]/layout.tsx`)
- Create: `src/components/cart/cart-badge.tsx` (header icon + count of lines and total knives)
- Create: `src/app/[locale]/cart/page.tsx` + `src/components/cart/cart-view.tsx` (server page loads validated prices for the cart's items; client view handles qty/remove/clear)
- Modify: `src/app/[locale]/services/page.tsx` + `src/components/services/plan-selector.tsx` — replace direct checkout push with `addToCart`; inline "Added to cart" feedback; "View cart" link
- Modify: `next.config.ts` — PT rewrite `/pt/carrinho` → `/pt/cart`
- i18n: add `cart` section to `en.ts`/`pt.ts` (Cart, Add to cart, Added to cart, View cart, Remove, Clear cart, Quantity, Continue shopping, Checkout, Cart empty, Subtotal, Total, Total images, currencyMismatch, priceChanged)

- [ ] **Steps: failing tests (cart-store normalization via jsdom-localStorage, component smoke) → implement → pass → commit** `feat: shopping cart UI with localStorage persistence`.

### Task 5: Checkout for cart

**Files:**
- Modify: `src/app/[locale]/checkout/page.tsx` — accept cart intent (items JSON in a hidden field or read cart server-side via action param); show per-item lines (angles, qty, subtotal), totals, total images, `fetchDeliveryEstimate(totalImages)`; login preservation via existing `next` param with cart in localStorage (survives magic link).
- Modify: `src/app/[locale]/checkout/actions.ts` — `createCartOrderAction` with Zod `cartIntentSchema`; calls `createCartOrder`; redirects to order page; clears cart server-side response is consumed client-side after redirect.
- Keep single-item checkout path working (compat) or route it through cart with one item — prefer the latter for DRY: single-item "Choose" now adds to cart too.

- [ ] **Steps: unit test action intent validation → implement → E2E in Task 8 → commit** `feat: cart checkout flow`.

### Task 6: Source photo intake for multi-item

**Files:**
- Modify: `src/services/source-photos.ts` — `authorizeSourcePhotoUpload...` loads items, maps global `knifeIndex` → owning item; per-knife max from order snapshot (unchanged, global); labels get item context.
- Modify: `src/app/[locale]/account/components` `source-photo-upload-area.tsx` — group knives by item: `Item 1 (3-angle) → Knives 1..1; Item 2 (1-angle) → Knife 2`; props now `items: { itemIndex, angles, knifeIndexStart, knifeQuantity }[]`.
- SQL: `register_source_image`/`submit_source_photos`/`maybe_mark_order_ready` already validated per global knife index (1..knife_quantity on orders) — migration 0017 updates these loops to iterate `order_items` ranges where present (fallback to legacy single-plan loop when no rows). Re-verify integration tests.
- Admin dashboard order detail: render items list (plan angles, qty, subtotal, images) + per-item knife grouping.

- [ ] **Steps: update integration tests for per-item knife validation → implement → commit** `feat: multi-item source photo intake and admin rendering`.

### Task 7: Payments compatibility

- Verify (unit + integration) mock and Stripe flows read `orders.total_cents`/`currency` — no per-item knowledge needed. Add integration case: multi-item order paid via `record_payment_intent`+`confirm_order_payment` with aggregate amount; amount mismatch rejected.
- Commit `test: multi-item payment compatibility coverage`.

### Task 8: E2E + docs

- Playwright: EN + PT, mobile + desktop viewport — services → add 1×3-angle → add 1×1-angle → cart (total 4 images, correct totals) → remove/re-add → checkout → login boundary (magic link test account) → order page shows both items → upload photos to knife 1 and knife 2 → finish submission.
- Docs: `docs/database.md` (order_items, create_cart_order, backfill), `CLAUDE.md` (cart architecture note), `README` if needed, `docs/project-brief.md` update.
- Commit `docs: multi-item cart documentation` + `test: cart e2e journeys`.

### Task 9: Regression gate

- Run `npm run lint`, `npm run typecheck`, `npm test`, integration suite, `npm run build`; E2E subset relevant to checkout/cart. Zero regressions accepted.
- Final checkpoint report per the user's template; stop — no merge, no deploy, no PROD.