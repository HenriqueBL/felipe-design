# Git Workflow — Felipe Design

## Main branch

`main` is the single source of truth. It must always be green: all quality gates pass (unit tests, integration tests, lint, typecheck, build). Never push directly to `main`; use feature branches and pull requests.

## Branch naming

Use short-lived branches with descriptive prefixes:

- `feature/*` — new functionality (e.g., `feature/e2e-client-flow`)
- `fix/*` — bug fixes (e.g., `fix/magic-link-redirect`)
- `test/*` — test additions or improvements (e.g., `test/checkout-e2e`)
- `chore/*` — maintenance tasks (e.g., `chore/update-dependencies`)
- `docs/*` — documentation only (e.g., `docs/api-reference`)
- `refactor/*` — code restructuring without behavior change (e.g., `refactor/payment-service`)

There is no permanent `develop` branch. All work merges into `main`.

## Before merge

Every PR must pass all quality gates locally before requesting review:

```bash
npm test
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

Integration tests require `.env.test.local` pointing to the authorized Supabase DEV project (`jfsymthtepikfpexzxvk`). The safety guard in the test harness aborts if the configuration is wrong.

## Commit convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) going forward. Existing historical commits are preserved as-is.

Types:

- `feat:` — new feature
- `fix:` — bug fix
- `test:` — adding or updating tests
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `docs:` — documentation only
- `chore:` — build process, tooling, dependencies
- `ci:` — CI configuration changes
- `perf:` — performance improvement
- `build:` — build system or external dependency changes

Examples:

```
feat: add client order result download
fix: preserve checkout intent after magic link redirect
test: add bilingual checkout e2e coverage
refactor: isolate payment provider selection logic
docs: update backend validation status
ci: add quality gates workflow
```

## Database changes

Migrations are versioned sequentially in `supabase/migrations/`. Never edit an already-applied migration. New schema changes go in the next numbered file (0008, 0009, …). Apply with `npx supabase db push --linked` against the DEV environment only.

## Secrets

Never commit:

- `.env.test.local`
- Supabase service role key or access tokens
- Database passwords
- API keys or credentials

These files are listed in `.gitignore`. If a secret is accidentally committed, rotate it immediately and remove it from history.

## Integration tests

Integration tests run exclusively against the authorized Supabase DEV project. The test harness enforces this via a safety guard that checks the project ref extracted from `NEXT_PUBLIC_SUPABASE_URL`. Tests will abort with a non-zero exit code if pointed at any other project.

Never run integration tests against production.