# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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