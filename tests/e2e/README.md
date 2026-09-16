# Felipe Design — E2E Test Suite

End-to-end tests validating the complete customer journey, authorization, error handling, and responsiveness of the Felipe Design web application against a real Supabase DEV environment.

## Prerequisites

-   Node.js 22+
-   Supabase DEV project configured and accessible
-   `.env.test.local` with valid credentials:
    ```bash
    NEXT_PUBLIC_SUPABASE_URL=<your-dev-url>
    NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-dev-anon-key>
    SUPABASE_SERVICE_ROLE_KEY=<your-dev-service-role-key>
    E2E_SAFETY_GUARD=DEV_ONLY
    ```
-   Playwright browsers installed: `npx playwright install chromium`

## Safety Guard

All E2E tests enforce a safety guard that verifies the target Supabase instance is explicitly marked as DEV. Tests will refuse to run against production or unverified environments to prevent accidental data corruption.

## Authentication Strategy

### Programmatic SSR Auth (Primary)
Journeys and functional tests use `authenticateWithSSR()` which programmatically establishes a valid session via Supabase Auth API and injects cookies directly into the browser context. This approach:
-   Bypasses email delivery dependencies
-   Validates middleware and Server Component session recognition
-   Enables reliable, fast execution of complex multi-step flows

### Magic Link (Real Flow)
**Status: NOT AUTOMATED**

The real Magic Link flow (`signInWithOtp` → email → callback → session exchange) requires access to an email inbox or external mail catcher service not currently integrated into this test harness. The programmatic SSR auth validates the *session establishment* and *middleware protection* layers, but does not exercise the email transport or link parsing logic.

Manual verification of Magic Link remains necessary for release sign-off until automated mail interception is added.

## Test Coverage

| Suite | File | Scope |
|-------|------|-------|
| Smoke | `smoke.spec.ts` | Basic page loads, locale switching, static assets |
| Auth SSR | `authenticated-session.spec.ts` | Session persistence, refresh, protected route access |
| EN Journey | `customer-journey-en.spec.ts` | Full EN flow: services → checkout → order → upload → admin → result → revision |
| PT Journey | `customer-journey-pt.spec.ts` | Full PT flow with canonical routes (`/pt/servicos`, `/pt/finalizar`, `/pt/conta`) and BRL currency |
| Authorization | `authorization.spec.ts` | Unauthenticated redirects, user vs admin access control, cross-user order isolation |
| Error States | `error-states.spec.ts` | Non-existent orders, invalid plans, invalid uploads, revision limits, unauthenticated actions |
| Mobile | `mobile-responsive.spec.ts` | Viewport 390×844: overflow detection, touch targets, layout integrity across EN/PT/Admin |

## Running Tests

```bash
# All E2E tests
npm run test:e2e

# Specific suite
npx playwright test tests/e2e/customer-journey-en.spec.ts --project=chromium-desktop

# With UI mode for debugging
npx playwright test --ui

# View trace from failed test
npx playwright show-trace test-results/<trace-path>/trace.zip
```

## Cleanup Strategy

Test fixtures are cleaned up deterministically after each spec via `cleanupUserData()`:

-   Uses `ON DELETE CASCADE` defined in migration `0001_schema.sql` for all order-related child tables (`order_images`, `order_revisions`, `payments`)
-   Storage objects cleaned separately before DB deletion (no cascade for storage buckets)
-   `payment_events` cleaned via `provider_event_id` (text column), matching mock payment identifiers
-   Post-cleanup verification logs warnings if residual data exists (may occur due to RLS/trigger edge cases in DEV), but does not fail the test suite

Cleanup is scoped to fixtures created by the current test execution only — never deletes unrelated data.

## Payment & Photos Ordering

The backend supports both event orderings:
-   Payment → Photos
-   Photos → Payment

The current customer UI enforces **payment-first** flow. E2E tests validate the UI's actual behavior, not the backend's full capability. Integration tests cover both orderings independently.

## Known Limitations

1.  **Magic Link**: Not automated (see above)
2.  **Cleanup Verification**: May log warnings in certain DEV configurations where RLS/triggers silently block service_role deletions despite API success. Does not affect test validity.
3.  **Mobile Testing**: Validates layout and accessibility at 390×844 viewport; does not simulate touch gestures or device-specific APIs beyond basic touch point emulation.

## Debugging Failed Tests

Each failure generates:
-   Screenshot: `test-results/<test-name>/test-failed-N.png`
-   Trace: `test-results/<test-name>/trace.zip`
-   Error context: `test-results/<test-name>/error-context.md`

Use `npx playwright show-trace <trace-path>` to step through DOM snapshots, network requests, and console logs at each action.