# Web Security Hardening

Decisions and pending items for production web hardening (branch `chore/security-hardening`).
Scope: web layer only. Migrations, RLS, RPCs, business rules and payments were NOT touched.

## Implemented (next.config.ts `headers()`)

| Header | Value | Notes |
|---|---|---|
| Content-Security-Policy | see below | compatible baseline, see rationale |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` | browsers exempt localhost in dev |
| X-Content-Type-Options | `nosniff` | |
| X-Frame-Options | `SAMEORIGIN` | redundant with `frame-ancestors 'self'` (covers old browsers) |
| Referrer-Policy | `strict-origin-when-cross-origin` | |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | app uses none of these |

## CSP rationale (why it is not stricter)

- `script-src 'unsafe-inline'`: Next.js emits inline bootstrap scripts; header-based CSP
  in `next.config.ts` is static, so per-request nonces are not possible without
  middleware per-response rewriting. Documented trade-off; a strict nonce-based CSP
  would require that rewriting plus full e2e re-validation.
- `'unsafe-eval'` in script-src only in `NODE_ENV=development` (React Fast Refresh).
- `connect-src`/`img-src` include the Supabase project URL derived from
  `NEXT_PUBLIC_SUPABASE_URL`: required for auth REST, Storage signed URLs and the
  tus-js-client XHR/fetch uploads (TUS resumable, browser -> Supabase directly).
- `img-src` also allows `blob:` and `data:` for local previews before upload completes.
- `form-action 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`.
- `upgrade-insecure-requests`: safe on Vercel (HTTPS only); no plaintext runtime deps.

## Audit findings already OK (no change needed)

- **Redirect safety**: `isSafeNextPath` (`src/domain/checkout.ts`) validates the `next`
  param on `/login` and `/auth/callback` — open-redirect protected, tested in
  `tests/checkout.test.ts`.
- **Service-role isolation**: `SUPABASE_SERVICE_ROLE_KEY` only read in
  `src/lib/supabase/server.ts` (`createSupabaseAdminClient`); never imported by
  `browser.ts` or client components; env documented as server-only.
- **Error leakage**: dashboard/account actions map error codes to curated messages
  before returning to the client; no raw stack traces reach the browser.

## PENDING (documented, not implemented on this branch)

- **Rate limiting**: real rate limiting needs a durable shared store (e.g. Upstash Redis
  or Vercel WAF). In-memory rate limiting is invalid on serverless (per-instance state)
  and would be fake hardening. Surfaces to cover when a provider is chosen:
  login magic-link requests, checkout `create_order` RPC, source-photo TUS uploads,
  contact/revision submissions.
- **Strict CSP with nonces**: requires per-response header rewriting in middleware and
  full E2E validation; candidate follow-up after monitoring production traffic on the
  current baseline.
- **HSTS preload submission**: header is shipped; enrolling the domain in the
  hstspreload.org list is an operational decision to be made post-launch.
