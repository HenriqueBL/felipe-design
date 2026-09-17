# Production smoke suite

Read-only HTTP smoke tests to validate Preview/Production deploys.

## Run

```bash
SMOKE_BASE_URL=http://localhost:3000 npm run test:smoke
```

`SMOKE_BASE_URL` defaults to `http://localhost:3000`. Never hardcode the
production domain; pass it via environment at deploy time:

```bash
SMOKE_BASE_URL=https://preview.example.com npm run test:smoke
```

## Safety guarantees

- GET requests only (enforced in code — any other method throws).
- No order creation, no uploads, no payment simulation, no credentials.
- Idempotent and fast (a handful of requests).

## Authenticated smoke (future extension)

Not implemented. A safe strategy when needed:

1. Create a dedicated throwaway test account in the target environment.
2. Export its magic-link session or email/password via env vars
   (`SMOKE_AUTH_EMAIL`, `SMOKE_AUTH_PASSWORD`), never committed.
3. Gate all authenticated checks behind `if (!process.env.SMOKE_AUTH_EMAIL) this.skip()`.
4. Assert only on status codes and redirects — never mutate account data.