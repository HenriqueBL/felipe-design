# Authentication & Email Production Readiness

This document covers the Supabase Auth + Magic Link + SMTP configuration
required to run Felipe Design in production. It is the single source of
truth for onboarding, troubleshooting, and release-gate verification.

## Architecture overview

- **Auth provider:** Supabase Auth (magic link only — no passwords).
- **Session transport:** HTTP-only cookies managed by `@supabase/ssr`.
- **Canonical origin:** `NEXT_PUBLIC_SITE_URL` (e.g. `https://felipesilvadesign.com`).
  All public redirects use `siteUrl()` from `src/lib/site.ts`, never
  `request.url`, which behind nginx/Docker resolves to the internal bind
  address (`http://0.0.0.0:3000`).
- **Locale routing:** `/en/*` and `/pt/*`. Callbacks preserve locale via
  the `next` query parameter when it passes `isSafeNextPath()`.
- **Admin gate:** `profiles.role = 'admin'` checked in middleware and RLS.
  Customers are redirected away from `/dashboard`.

## Supabase Auth URL configuration

In the Supabase Dashboard → Authentication → URL Configuration:

| Field                  | DEV value                              | PROD value                                |
| ---------------------- | -------------------------------------- | ----------------------------------------- |
| Site URL               | `http://localhost:3000`                 | `https://felipesilvadesign.com`           |
| Redirect URLs (allow)  | `http://localhost:3000/auth/callback` | `https://felipesilvadesign.com/auth/callback` |

Add both `/en` and `/pt` variants if you want locale-specific landing
pages after sign-in; the callback route handles them via `?next=`.

> ⚠️ Never add wildcard external domains to the redirect allowlist.
> The application rejects unsafe `next` values server-side
> (`isSafeNextPath` in `src/domain/checkout.ts`), but the Supabase
> allowlist is the second line of defense.

## SMTP / Email provider

Supabase Auth sends magic links through its built-in email service by
default. For production deliverability you should configure a custom
SMTP provider.

### Required SMTP fields (Supabase Dashboard → Authentication → Emails → SMTP Settings)

| Field             | Description                                      | Example                       |
| ----------------- | ------------------------------------------------ | ----------------------------- |
| Sender name       | Display name in the From header                  | `Felipe Design`               |
| Sender email      | Verified sending address                         | `noreply@felipesilvadesign.com` |
| SMTP host         | Your provider's SMTP hostname                    | `smtp.resend.com`             |
| SMTP port         | Usually 587 (TLS) or 465 (SSL)                   | `587`                         |
| Username          | SMTP username / API key identifier                | `resend`                      |
| Password          | SMTP password / API key (**secret**)              | *(stored in env/vault)*       |
| Enable TLS        | Required for port 587                            | ✅                            |

### Environment variables (application side)

The Next.js app does **not** send emails directly — Supabase Auth does.
These variables are only needed if you integrate a separate transactional
email service in the future:

```bash
# Not required for Supabase Auth magic links
# NEXT_PUBLIC_SITE_URL=https://felipesilvadesign.com
```

`NEXT_PUBLIC_SITE_URL` is used exclusively for constructing canonical
redirect URLs, not for SMTP.

### DEV vs PROD separation

- **DEV:** Use Supabase's built-in email service or a test SMTP sandbox
  (e.g. Mailtrap, Resend test mode). Never send to real customer addresses.
- **PROD:** Use a verified domain with SPF/DKIM/DMARC configured.
  Monitor bounce rates and spam complaints.
- **Never** copy DEV SMTP credentials into PROD.
- **Never** log SMTP passwords or API keys.

## Magic link email template

Supabase allows customizing the magic link email template in
Dashboard → Authentication → Email Templates → Magic Link.

### Recommended template structure

```html
<h2>Sign in to Felipe Design</h2>
<p>You requested a sign-in link. Click below to continue:</p>
<a href="{{ .ConfirmationURL }}">Sign in to Felipe Design</a>
<p>If you didn't request this, ignore this email. The link expires in 1 hour.</p>
<p>This link is for <strong>{{ .Email }}</strong>. Do not share it.</p>
```

Key requirements:
- Clear CTA button/link with brand name.
- Textual fallback URL (`{{ .ConfirmationURL }}`) for clients that strip links.
- Reason for the email ("You requested a sign-in link").
- Ignore-if-not-requested disclaimer.
- No sensitive data beyond the recipient's own email.
- Expiry notice. **Do not state a specific duration** (e.g. "1 hour") unless the
  token lifetime has been verified in Dashboard → Authentication → Providers → Email → Token expiry.
  Supabase defaults may differ; always match the template text to the configured value.

### Bilingual considerations

Supabase sends one template per language setting. If your user base is
bilingual, keep the template in English (the default) and rely on the
landing page (`/en/login` or `/pt/login`) for localized UX after click.
Alternatively, configure separate templates if Supabase supports
locale-based template selection at send time.

## Rate limiting

Supabase Auth enforces rate limits on magic link requests per email/IP.
The application maps these to user-friendly messages:

| Supabase signal                          | User-facing message (EN)                                              | User-facing message (PT)                                                    |
| ---------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `status === 429` or `over_email_send_rate_limit` | "Too many sign-in attempts. Please wait a few minutes and try again." | "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente."    |

The login form (`src/components/login-form.tsx`) detects rate-limit
errors and displays the appropriate message without exposing backend
details. No custom rate limiter is implemented client-side — Supabase
is the authority.

## Security checklist

- [ ] `NEXT_PUBLIC_SITE_URL` set to canonical production domain.
- [ ] Supabase redirect allowlist contains only `felipesilvadesign.com/auth/callback/**`.
- [ ] `siteUrl()` used in all server-side redirects (callback, signout).
- [ ] `isSafeNextPath()` validates every `next` parameter before redirect.
- [ ] Service role key never exposed to browser or client components.
- [ ] `profiles.role` checked in middleware for `/dashboard` access.
- [ ] RLS policies enforce row-level access on `orders`, `profiles`, etc.
- [ ] SMTP credentials stored in Supabase dashboard, not in `.env`.
- [ ] No secrets in logs, error messages, or client bundles.
- [ ] Magic link expiry set to reasonable duration (default 1h).

## Testing

### Unit tests

```bash
npm test -- tests/auth-callback.test.ts
npm test -- tests/auth-callback-errors.test.ts
```

Coverage:
- Canonical origin in redirects (never `0.0.0.0`).
- Safe `next` parameter preserved.
- External `next` rejected.
- Callback error params surfaced to login page.
- Code exchange failure redirects with error context.

### E2E tests

```bash
npm run test:e2e
```

Relevant specs:
- `tests/e2e/authenticated-nav.spec.ts` — session persistence.
- `tests/e2e/authorization.spec.ts` — admin/customer gating.
- `tests/e2e/signout-ui.spec.ts` — logout flow.
- `tests/e2e/helpers/auth.ts` — programmatic magic link generation.

### Manual verification

1. Request magic link on `/en/login` → check inbox → click link → land on `/en`.
2. Repeat on `/pt/login` → land on `/pt`.
3. Use expired link → see callback error message on login page.
4. Rapid-fire submissions → see rate-limit message.
5. Access `/en/dashboard` as customer → redirected to home.
6. Access `/en/account` unauthenticated → redirected to login with `next`.
7. Sign out → redirected to `/en` via canonical origin.

## Rollback

If auth breaks after deploy:

1. Revert the PR that introduced the change.
2. Verify `NEXT_PUBLIC_SITE_URL` still points to the correct origin.
3. Check Supabase dashboard for SMTP or URL config changes.
4. Clear browser cookies/sessions if cookie schema changed.

## Troubleshooting

| Symptom                                  | Likely cause                                          | Fix                                                  |
| ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Redirect to `http://0.0.0.0:3000`       | Using `request.url` instead of `siteUrl()`            | Ensure all routes import and call `siteUrl()`        |
| Magic link lands on wrong locale         | `next` param missing or stripped                      | Check `signInWithOtp` options include `?next=/pt`    |
| "Invalid grant" on callback              | Link expired or already used                          | User sees callback error; request new link           |
| Rate limit on first attempt              | Shared IP / VPN / prior testing                       | Wait or switch network                               |
| Emails not arriving                      | SMTP misconfigured or domain not verified             | Check Supabase Email settings + SPF/DKIM             |
| Customer accesses `/dashboard`           | `profiles.role` not set or middleware bypassed        | Verify RLS + middleware profile check                |
| Open redirect to external site           | `next` validation bypassed                            | Confirm `isSafeNextPath()` is called before redirect |

## Production deployment checklist

Before enabling auth in production:

- [ ] Set `NEXT_PUBLIC_SITE_URL=https://felipesilvadesign.com` in hosting env.
- [ ] Configure Supabase Site URL and redirect allowlist for production domain.
- [ ] Configure custom SMTP with verified sender domain.
- [ ] Set up SPF, DKIM, and DMARC for the sending domain.
- [ ] Test magic link flow end-to-end with a real email address.
- [ ] Verify admin dashboard access with an admin account.
- [ ] Verify customer cannot access admin routes.
- [ ] Run full E2E suite against staging environment.
- [ ] Review rate-limit behavior under load.
- [ ] Confirm no secrets in build output or client bundle.