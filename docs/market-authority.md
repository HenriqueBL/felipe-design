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

Country extraction in production is **DISABLED by default**. The application will NOT read `cf-ipcountry`, `x-vercel-ip-country`, or any other geo header unless the environment variable `TRUSTED_GEO_SOURCE` is explicitly set to the header name that the infrastructure guarantees is trusted.

**Current state**: `TRUSTED_GEO_SOURCE` is NOT set. All production traffic falls back to `en/USD`.

**To enable geo-lock in production:**
1. Configure nginx/Cloudflare to strip client-supplied geo headers and inject a trusted one
2. Set `TRUSTED_GEO_SOURCE=<header-name>` (e.g., `TRUSTED_GEO_SOURCE=cf-ipcountry`)
3. Only then will the application read that specific header

Without this explicit opt-in, spoofed headers cannot influence locale or currency on the unconfigured VPS.

### Development & Testing

When `NODE_ENV !== "production"`, the middleware accepts:
- `x-test-country` — a 2-letter ISO country code header for simulating any market

This header is **ignored in production** regardless of `TRUSTED_GEO_SOURCE` and exists solely for local development and E2E testing.

## Accept-Language

`Accept-Language` is **not authoritative** for public locale or currency resolution. A Brazilian user with `Accept-Language: en-US` receives `pt/BRL`. A Portuguese user with `Accept-Language: pt-PT` receives `en/USD`.

## Currency Authority

Currency is resolved exclusively on the server at every layer:
- **Services page**: Server resolves currency from country header; no query param or toggle.
- **Cart pricing API** (`/api/cart-pricing`): Ignores any client-supplied currency; resolves from request headers.
- **Checkout (single + cart)**: Server resolves currency before calling order creation RPCs.
- **Order creation**: RPC receives server-resolved currency only. FormData/query currency values are never trusted.
- **localStorage cart**: Stores intent only (planId + quantity). Legacy carts with a `currency` field are accepted during parsing but the currency value is **discarded** — items are always preserved. Display and pricing always use server-authoritative currency.

### Query String Override

`?currency=USD` or `?currency=BRL` query parameters are **stripped** during redirects and **ignored** by all server endpoints. They cannot influence pricing or order creation.

## Fallback

When no trusted country header is available (missing, empty, untrusted, or `TRUSTED_GEO_SOURCE` not configured), the system defaults to:
- Locale: `en`
- Currency: `USD`

This ensures a safe, consistent experience for all visitors regardless of infrastructure state.

## SEO

Both `/en` and `/pt` routes remain fully indexable:
- `sitemap.xml` includes all localized URLs
- `hreflang` alternates are preserved in metadata
- `x-default` points to `/en`
- Crawler User-Agents (Googlebot, Bingbot, etc.) are **not** geo-redirected, allowing search engines to index both language versions

Human visitors are redirected to their market-appropriate locale; crawlers access both. Crawler status does NOT grant currency override authority — checkout and order creation remain server-authoritative regardless of User-Agent.

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

### Nested Route Mapping

| PT Path                      | EN Path                        |
|------------------------------|--------------------------------|
| /pt/conta/pedidos/:id        | /en/account/orders/:id         |
| /en/account/orders/:id       | /pt/conta/pedidos/:id          |

All segments are translated semantically; dynamic parameters (orderId) are preserved.

## Implementation Reference

- Market resolution: `src/lib/market.ts` (`resolveMarket`, `extractCountry`)
- Middleware redirects: `src/middleware.ts`
- Checkout domain: `src/domain/checkout.ts` (`currencyForCountry`)
- Cart pricing: `src/app/api/cart-pricing/route.ts`
- Services page: `src/app/[locale]/services/page.tsx`
- Checkout actions: `src/app/[locale]/checkout/actions.ts`
- Cart schema: `src/domain/cart.ts` (items-only; legacy currency discarded)
- Cart store: `src/lib/cart-store.ts` (server-authoritative reconciliation)