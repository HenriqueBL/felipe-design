# Payment Provider Comparison

Research date: 2026-09-16. Branch: `chore/payment-gateway-prep`. Follows [payment-gateway-readiness.md](payment-gateway-readiness.md).

**Important:** fee data below reflects what was retrievable from official pages
on 2026-09-16. Stripe fees were verified on https://stripe.com/pricing. Pagar.me
structural data came from https://pagar.me (landing page only — no fee table).
Mercado Pago's pricing pages (mercadopago.com.br/empresas/precos, /custo)
returned HTTP 403 to automated fetch, so its fees remain **UNVERIFIED** —
consult the official page manually before deciding.

## Official sources to consult (required before decision)

- Stripe: https://stripe.com/pricing (BR + international pricing pages), docs at
  https://docs.stripe.com — webhooks, Checkout, IdempotentRequests, API keys.
- Mercado Pago: https://www.mercadopago.com.br (tarifas; desarrolladores/docs),
  webhooks and Checkout Pro documentation.
- Pagar.me / Stone: https://pagar.me and https://stone.com.br — pricing and API
  docs (v5), and account-opening requirements for Brazilian companies.

## Structural comparison (capabilities, not fees)

| Dimension | Stripe | Mercado Pago | Pagar.me/Stone |
|---|---|---|---|
| Availability for Brazilian company | Global platform; BR entities can onboard (UNVERIFIED current terms) | Native BR | Native BR |
| BRL | Yes (BR charging) | Yes (core) | Yes (core) |
| USD | Yes (international charging; settlement/FX terms UNVERIFIED) | Limited/limited international charging (UNVERIFIED scope) | Limited (UNVERIFIED) |
| National card | Yes (BR acquirer routing) | Yes (Pix/card split) | Yes (Stone acquiring) |
| International card | Strong | Partial | Partial |
| Pix | Yes (Pix on BR accounts) | Yes (core strength) | Yes (UNVERIFIED scope) |
| Hosted checkout | Stripe Checkout (hosted) | Checkout Pro (hosted) | Checkout (UNVERIFIED feature scope) |
| Custom checkout | Payment Element / Elements | Checkout API | Transparent checkout (UNVERIFIED) |
| Webhooks | Mature; HMAC signature (Stripe-Signature, timestamped) | Yes; signature verification (x-signature) | Yes (UNVERIFIED scheme) |
| Idempotency keys | First-class header on all writes | Partial / provider-specific (UNVERIFIED) | UNVERIFIED |
| Refunds via API | Yes | Yes | Yes (UNVERIFIED partial refunds) |
| Chargebacks/disputes | Mature dispute API + dashboard | Dashboard | Dashboard |
| Currencies accepted | 135+ | BR-focused + LatAm (UNVERIFIED full list) | BRL-centric (UNVERIFIED) |
| Settlement | BR-local for BRL; FX for cross-border (UNVERIFIED terms) | BR-local | BR-local (Stone) |
| FX conversion | Treasury/cross-border (UNVERIFIED fees) | Limited | Limited |
| International customer experience | Strong (localized checkout, USD native) | Medium | Medium/Weak |
| API quality | Excellent | Good | Good (v5 REST) |
| Node/TS SDK | First-class (stripe-node, typed) | Official SDK (mercadopago) | OpenAPI/official (UNVERIFIED TS support) |
| Sandbox | Full test mode + webhook CLI | Test credentials + test cards | Sandbox (UNVERIFIED) |
| Observability/dashboard | Best-in-class | Good | Good |
| Integration complexity | Low-medium via SDK | Medium | Medium |
| Current fees | VERIFIED (stripe.com/pricing, 2026-09-16): BR cards 3.99% + R$ 0.39; international cards +2%; Pix 1.19% (invite-only); boleto R$ 3.45; dispute R$ 55.00 | UNVERIFIED (pricing page blocks automated fetch — check mercadopago.com.br) | UNVERIFIED (landing page only — ask Stone for proposal; next-day settlement into Conta Stone) |
| Extra costs (chargeback, FX, payout, monthly) | UNVERIFIED | UNVERIFIED | UNVERIFIED |

## Architecture options

### A — Single provider for BRL + USD

- **Pros:** one webhook route, one reconciliation job, one set of env keys, one
  contract in `PaymentProvider`, unified accounting/reporting.
- **Cons:** the provider must genuinely serve BOTH native BRL (Pix etc.) and
  native USD without imposed FX; if it can't, this option is off the table.
  Cross-border settlement of USD to a Brazilian entity may carry FX fees.
- **Complexity:** lowest — one provider module + one webhook route.
- **Impact on `PaymentProvider`:** none (registry already multi-provider).
- **Reconciliation:** single client implementation.
- **Support:** single vendor relationship.
- **Accounting:** one source of truth for both currencies.

### B — BR provider (BRL) + international provider (USD)

- **Pros:** best local payment UX each side (Pix/BR cards via Mercado Pago or
  Pagar.me; USD via Stripe); no FX imposition anywhere.
- **Cons:** two webhook routes, two signature schemes, two reconciliation jobs,
  two dashboards, two sets of keys and env vars; accounting must merge two
  exports; more failure surface; currency routing logic at intent creation.
- **Complexity:** highest.
- **Impact on `PaymentProvider`:** still compatible (registry per id), but the
  webhook route must dispatch per provider and each provider validates its own
  signature format.
- **Reconciliation:** two implementations.
- **Support:** two vendor relationships.
- **Accounting:** two ledgers merged monthly.

### C — Primary provider now, fallback later

- **Pros:** smallest initial scope; add a second provider only if primary has a
  real gap (e.g. weak USD handling); architecture already anticipates it
  (registry + enum with multiple providers).
- **Cons:** deferred cost; migration/refund edge cases when switching or adding
  mid-flight; risk of lock-in in operational habits.
- **Complexity:** lowest now, moderate later.
- **Impact on `PaymentProvider`:** none; enum `payment_provider` already has
  stripe/mercadopago/nowpayments (a new provider needs `alter type add value`).
- **Reconciliation:** one now, +1 if fallback added.
- **Support/accounting:** single now, grows with fallback.

## BLOCKER: amount/currency validation in confirm_order_payment

Current RPC `confirm_order_payment` (migration 0006) trusts `p_amount_cents`
and `p_currency` from the caller. The mock flow always passes the order's own
snapshot, masking the gap; a real webhook path would pass provider-reported
values.

**Required fix (before enabling real payments):** inside `confirm_order_payment`,
after loading `v_order`:

1. `v_amount = v_order.total_cents` and `v_currency = v_order.currency` are the
   authority — reject (`PAYMENT_AMOUNT_MISMATCH` / `PAYMENT_CURRENCY_MISMATCH`)
   when `p_amount_cents <> v_order.total_cents` or `p_currency <> v_order.currency`.
2. Signature verification happens above the RPC (webhook route, via
   `parseWebhookEvent`) — RPC callers must be restricted (only service_role from
   the webhook route) since it is SECURITY DEFINER.
3. Event dedup remains `(provider, provider_event_id)`; already-paid early
   return (idempotent, deadline never decreases).
4. Cancelled/failed events: record in `payment_events` and `payments.status`
   without touching `paid_at` if already paid; `refunded` transitions need a
   dedicated decision (order already in production?).
5. Delayed webhook: define whether `paid_at` is our processing time or the
   provider event timestamp (affects cutoff) — human decision.
6. Reconciliation: periodic status check for `pending` payments older than N
   hours, to cover missed webhooks.

Full gate to mark paid:

```
provider event signature verified (app layer)
AND order exists
AND currency == order.currency
AND amount == order.total_cents (snapshot)
AND (provider, provider_event_id) not previously processed
```

## Human decisions pending

1. Choose provider (A/B/C shape + vendor) — needs current official fee research.
2. One vs two providers.
3. Amount-mismatch webhook response semantics (4xx vs 200+alert).
4. Refunds in v1 or manual via provider dashboard.
5. `paid_at` = processing time vs provider event timestamp (cutoff impact).
6. Reconciliation cadence and alert channel.

## Candidates for human evaluation (no ranking)

- Stripe
- Mercado Pago
- Pagar.me (Stone)
- (already in enum: NowPayments — crypto-oriented; evaluate only if that is desired)

## Implementation checklist (after decision)

- [ ] Verify current fees/requirements on official pages (BLOCKER for decision)
- [ ] Migration: amount/currency validation in `confirm_order_payment` (BLOCKER)
- [ ] Migration: `alter type payment_provider add value` for chosen provider (if new)
- [ ] Migration: failed/cancelled/refunded status transitions
- [ ] Provider SDK install (human approval required)
- [ ] Webhook route with signature verification
- [ ] Checkout action creating real intent
- [ ] Reconciliation job
- [ ] Test plan from payment-gateway-readiness.md