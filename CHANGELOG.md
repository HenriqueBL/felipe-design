# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-28

### Added

- Portfolio media integrity constraints: `portfolio_item_media` table, `hero_media_id`, focal point support, position CHECK (1..3), UNIQUE deferrable constraint, and hero ownership trigger (migrations 0022–0027).
- Secure `remove_portfolio_media(UUID)` RPC with SECURITY DEFINER and `auth.uid()` authority (migration 0027).
- Grant hardening: EXECUTE on `remove_portfolio_media(UUID)` revoked from PUBLIC/anon, granted only to authenticated (migration 0028).
- Blue/green production deployment infrastructure with isolated Compose project and nginx upstream cutover.

### Security

- Removed vulnerable 2-arg `remove_portfolio_media(UUID, UUID)` function that allowed privilege escalation via caller-supplied admin UUID.
- Hardened 1-arg `remove_portfolio_media(UUID)` grants: PUBLIC and anon can no longer invoke the RPC; authenticated callers still pass through internal `auth.uid()` admin check.
- Production geo remains disabled (`TRUSTED_GEO_SOURCE` unset); forged `CF-IPCountry`, `X-Vercel-IP-Country`, `X-Test-Country`, and `X-Origin-Country` headers are ignored.

### Deployment

- Production release SHA: `38750e5492b8b7ffccc5d12b6a222d3c673c32b5`.
- Database migrated through 0028 (grant hardening).
- Active production served via GREEN container on `127.0.0.1:3310`.
- BLUE rollback container retained on `127.0.0.1:3300`.
- Nginx upstream switched from 3300 to 3310; backup at `/etc/nginx/sites-available/felipesilvadesign.com.pre-green-20260928T165811`.
- Cloudflare, DNS, UFW unchanged.

## [0.1.0] - 2026-09-15

### Added

- Next.js 15 App Router foundation with bilingual routes (`/en`, `/pt`)
- Supabase Auth with magic link authentication
- Plans and historical pricing schema with active/vigente price selection
- Checkout flow with server-side price snapshot and idempotency
- Atomic `create_order` RPC with price freeze and deadline calculation
- Customer account dashboard with order listing and detail view
- Source image upload to private `client-uploads` Storage bucket
- Production-ready queue rule: `promised_delivery_date` calculated only after payment + complete photos
- Definitive delivery date calculation with business days, cutoff time, and timezone support
- Row-Level Security (RLS) policies for all tables (owner isolation, admin access)
- Storage policies for `client-uploads` (private), `order-results` (private), `portfolio` (public)
- Admin order handling with `set_order_status` RPC and authorization guard
- Mock payment architecture with `MockPaymentProvider`, `record_payment_intent`, and `confirm_order_payment` RPCs
- Order results delivery via `order-results` Storage bucket with owner-only download
- Free revision flow (round 1) with `order_revisions` table and RLS
- Bilingual EN/PT structure with validated dictionary types
- Integration test infrastructure against Supabase DEV with safety guard

### Security

- RLS isolation: users can only access their own orders, images, revisions, and payments
- Private `client-uploads` bucket: cross-user upload/download blocked
- Private `order-results` bucket: admin upload, owner download, cross-user/anon denied
- Server-only service credentials: `SUPABASE_SERVICE_ROLE_KEY` never exposed to frontend
- DEV Supabase integration safety guard: aborts if project ref != authorized DEV project
- `is_admin()` SECURITY DEFINER function centralizes authorization checks

### Tests

- 56 unit tests covering business days, pricing, checkout validation, and queue engine
- 30 Supabase integration tests against real PostgreSQL DEV instance
- Concurrency coverage: simultaneous orders, same-order race conditions, duplicate calls
- RLS coverage: orders, order_images, payments, profiles, order_revisions (owner/other/anon)
- Storage coverage: client-uploads upload/download, order-results upload/download, portfolio public read
- Admin authorization coverage: normal user DENIED, admin ALLOWED with state persistence verification
- MockPaymentProvider integration coverage: full abstraction path via `simulateMockPayment`