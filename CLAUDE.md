# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start dev server
- `npm run build` — production build (requires Supabase env vars from `.env.example`)
- `npm run lint` — ESLint 9; must pass with zero errors before commit
- `npm run typecheck` — `tsc --noEmit`; must pass with zero errors before commit
- `npm test` — Vitest run (business rules: pricing, business-days, queue)
- `npx vitest tests/queue.test.ts` — run a single test file
- `supabase db push` — apply migrations in order (0001 through 0005)

## Architecture

Next.js 15 App Router + Supabase (PostgreSQL, Auth magic link, Storage). Bilingual routes via `[locale]` segment (`/en`, `/pt`); English is default. Portuguese public paths (`/pt/servicos`, `/pt/finalizar`, `/pt/conta`) are rewrites in `next.config.ts` mapping to internal English slugs.

### Data flow (strict layering)

1. **Routes** (`src/app/[locale]/...`) — server components that load data via services and render. Never call Supabase directly.
2. **Server actions** (`src/app/[locale]/*/actions.ts`) — validate input with Zod, call services, revalidate paths. All form submissions go through actions.
3. **Services** (`src/services/`) — orchestrate Supabase queries and RPCs. No React imports. Centralize all data access here.
4. **Domain** (`src/domain/`) — pure, testable functions (business days, zoned time, checkout validation, upload rules). No I/O.
5. **Supabase clients** (`src/lib/supabase/`) — browser, server (cookies), admin (service role, server-only).

Key invariant: the server is the sole authority for price and deadline. The frontend only displays estimates; `create_order` and `confirm_order_payment` RPCs compute authoritative values atomically.

### Deadline & queue engine

Implemented identically in TypeScript (`src/services/queue.ts`, pre-purchase estimate) and SQL (`create_order`/`estimate_delivery` RPCs, authoritative at purchase). Rule: `ceil((backlog + new_images) / daily_capacity)` business days from the first production day. Cutoff time and timezone live in `app_settings` (default 17:00, America/Sao_Paulo). Concurrent orders are serialized via `SELECT ... FOR UPDATE` on `app_settings`. `promised_delivery_date` never decreases after payment confirmation. See `docs/queue-and-deadline.md` for full specification.

### Payments

Abstraction in `src/services/payment-providers.ts` with a registry pattern. Mock provider (`ENABLE_MOCK_PAYMENTS=true`) simulates the intent → webhook confirmation cycle using `record_payment_intent` and `confirm_order_payment` RPCs. Real providers (Stripe, Mercado Pago, NowPayments) are planned but not implemented. Tables `payments` and `payment_events` enforce idempotency via unique constraints on `(provider, external_payment_id)` and `(provider, provider_event_id)`.

### i18n

Dictionaries in `src/lib/i18n/{en,pt}.ts`. The `pt` dictionary is validated against the `Dictionary` type exported by `en.ts` — any new key must exist in both files. `generateMetadata` emits canonical and hreflang tags.

### Auth & authorization

Supabase Auth magic link; session refreshed in `src/middleware.ts`. Middleware protects `/{locale}/dashboard` (requires `profiles.role = admin`) and `/{locale}/account` (requires authenticated user). RLS in PostgreSQL is the real access barrier — never rely on frontend checks alone.

## Conventions

- TypeScript strict, no `any`. Database types in `src/types/database.ts` mirror migrations (Row/Insert/Update format).
- Components PascalCase, files kebab-case, 2-space indent, max 100 chars per line.
- Form components are client components using `useActionState`.
- Zod schemas in actions must mirror SQL constraints (same min/max/length limits).
- Prefer separate Supabase queries joined in code over embedded relations (`select("*, rel(*)")`) to avoid complex relationship typing.
- Commits: imperative mood with optional scope (e.g., `feat: add order deadline calculation`).

## Key documentation

- `docs/project-brief.md` — product source of truth
- `docs/architecture.md` — layer decisions and conventions
- `docs/database.md` — schema, RLS policies, storage, RPCs
- `docs/queue-and-deadline.md` — deadline rule, concurrency, cutoff
- `AGENTS.md` — contribution guidelines