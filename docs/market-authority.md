# Market Authority: Geo Locale + Currency Lock

## Commercial Rule

Felipe Design operates with a single, server-authoritative market resolution rule:

| Country | Locale | Currency |
|---------|--------|----------|
| BR      | pt     | BRL      |
| Any other (including unknown) | en | USD |

This rule is **absolute**. There is no manual language selector, no currency toggle, and no client-side override mechanism.

## Country Source

### Production (VPS + nginx)

Country is extracted from trusted proxy headers in this priority order:

1. `cf-ipcountry` — injected by Cloudflare when proxying is active
2. `x-vercel-ip-country` — injected by Vercel Edge Network

**Current state**: The production VPS does NOT currently have a trusted proxy injecting these headers. Until infrastructure is configured, all production traffic falls back to `en/USD`.

**Infrastructure requirement**: To activate geo-lock in production, configure nginx (or place Cloudflare in front) to inject one of the above headers. The application code is ready; only the infra layer is pending.

### Development & Testing

When `NODE_ENV !== "production"`, the middleware also accepts:

- `x-test-country` — a 2-letter ISO country code header for simulating any market

This header is **ignored in production** and exists solely for local development and E2E testing.

## Accept-Language

`Accept-Language` is **not authoritative** for public locale or currency resolution. A Brazilian user with `Accept-Language: en-US` receives `pt/BRL`. A Portuguese user with `Accept-Language: pt-PT` receives `en/USD`.

## Currency Authority

Currency is resolved exclusively on the server at every layer:

- **Services page**: Server resolves currency from country header; no query param or toggle.
- **Cart pricing API** (`/api/cart-pricing`): Ignores any client-supplied currency; resolves from request headers.
- **Checkout (single + cart)**: Server resolves currency before calling order creation RPCs.
- **Order creation**: RPC receives server-resolved currency only. FormData/query currency values are never trusted.
- **localStorage cart**: On mount, the client reconciles its stored currency against the server-resolved value. Mismatched carts are cleared (items preserved only if currency matches).

### Query String Override

`?currency=USD` or `?currency=BRL` query parameters are **stripped** during redirects and **ignored** by all server endpoints. They cannot influence pricing or order creation.

## Fallback

When no trusted country header is available (missing, empty, or untrusted), the system defaults to:

- Locale: `en`
- Currency: `USD`

This ensures a safe, consistent experience for all visitors regardless of infrastructure state.

## SEO

Both `/en` and `/pt` routes remain fully indexable:

- `sitemap.xml` includes all localized URLs
- `hreflang` alternates are preserved in metadata
- `x-default` points to `/en`
- Crawler User-Agents (Googlebot, Bingbot, etc.) are **not** geo-redirected, allowing search engines to index both language versions

Human visitors are redirected to their market-appropriate locale; crawlers access both.

## Redirect Behavior

### Human Visitors

- `/` → `/{market.locale}`
- Wrong locale path → equivalent path in correct locale (e.g., `/en/services` → `/pt/servicos` for BR)
- Query params preserved except `currency` (stripped)

### Slug Mapping

| PT Public Slug | EN Internal Slug |
|----------------|------------------|
| servicos       | services         |
| sobre          | about            |
| galeria        | gallery          |
| finalizar      | checkout         |
| carrinho       | cart             |
| conta          | account          |

## Implementation Reference

- Market resolution: `src/lib/market.ts` (`resolveMarket`, `extractCountry`)
- Middleware redirects: `src/middleware.ts`
- Checkout domain: `src/domain/checkout.ts` (`currencyForCountry`)
- Cart pricing: `src/app/api/cart-pricing/route.ts`
- Services page: `src/app/[locale]/services/page.tsx`
- Checkout actions: `src/app/[locale]/checkout/actions.ts`