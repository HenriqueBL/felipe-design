# Production Deploy Runbook

Fundação de deploy para VPS (Docker Compose) do Felipe Design. Domínio,
DNS, Cloudflare e nginx real ainda não configurados: use placeholders
(`<dominio>`, `127.0.0.1:3000`) — não invente URLs.

## Arquitetura

- Next.js 15 standalone (`output: "standalone"` no next.config.ts) — image
  Node 20 alpine, multi-stage, não-root.
- App stateless localmente; uploads e dados vivem no Supabase.
- Único serviço Compose com porta em `127.0.0.1` — proxy reverso externo
  (nginx) termina HTTPS e repassa.
- Health: `/api/health/live`.

## Env: build-time vs runtime

### Build-time (NEXT_PUBLIC_*)

`NEXT_PUBLIC_*` são inlined no client bundle pelo `next build`. Portanto:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e
  `NEXT_PUBLIC_SITE_URL` precisam existir **no ambiente em que o build roda**
  se quiser os valores reais embutidos no client.

Fluxo seguro adotado (evita secret em layers/build args):

1. `scripts/deploy-production.sh` extrai SOMENTE as três vars
   `NEXT_PUBLIC_*` de `.env.production` (parser controlado, sem
   `source`) e as passa ao `docker build` como `--build-arg` públicos.
2. O build stage do Dockerfile as recebe via `ARG`/`ENV` antes do
   `next build`, então o client bundle já sai com os valores corretos.

NUNCA passe `SUPABASE_SERVICE_ROLE_KEY` como Docker build arg — ela entra
somente em runtime via `env_file: .env.production`.

### Runtime-only (secrets)

- `SUPABASE_SERVICE_ROLE_KEY` — server-only, runtime.
- `STRIPE_SECRET_KEY` — server-only, runtime (formato `sk_test_...` ou
  `sk_live_...`). Nunca Docker ARG; nunca NEXT_PUBLIC.
- `STRIPE_WEBHOOK_SECRET` — server-only, runtime (formato `whsec_...`).
  Nunca Docker ARG; nunca NEXT_PUBLIC.
- `ENABLE_MOCK_PAYMENTS` — deve estar ausente ou `false` em PROD
  (guard no `scripts/validate-production-env.mjs` e no ENTRYPOINT).

### .env.production (template)

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<jwt>
SUPABASE_SERVICE_ROLE_KEY=<jwt>
NEXT_PUBLIC_SITE_URL=https://<dominio>
STRIPE_SECRET_KEY=<stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-signing-secret>
APP_IMAGE=felipe-design:<sha>
APP_PORT=3000
# ENABLE_MOCK_PAYMENTS omitido
```

Validação fail-fast: `node scripts/validate-production-env.mjs` (erro
contém apenas NOME da variável, nunca valor). Roda como parte do
ENTRYPOINT (`scripts/docker-entrypoint.sh`): se a validação falha o
container morre imediatamente; se passa, o entrypoint faz
`exec node server.js` e o Node vira o processo principal (recebe sinais
corretamente).

## Fluxo de deploy

1. **Tag/release SHA**: decide o SHA exato (merge para `main` + tag opcional).
2. **Release gate PASS** (local): lint, typecheck, unit, build, Integration,
   E2E e Smoke conforme o gate final definido para o projeto.
3. **Backup pré-deploy** (ver docs/backup-and-restore.md): pg_dump + sync
   de Storage.
4. **Env validation** na VPS:
   `docker run --rm --env-file .env.production -e NODE_ENV=production <image> node scripts/validate-production-env.mjs`
5. **Migrations EXPLÍCITAS**: `supabase db push` é sempre manual e
   consciente — o deploy script NÃO roda migrations. Revise o diff de
   migrations, faça push, verifique schema compatível com o app da versão.
6. **Image/start**:
   `scripts/deploy-production.sh <sha>` — builda `felipe-design:<sha>`,
   valida env, sobe o compose.
7. **Health**: script aguarda `/api/health/live`; aborta com logs se falhar.
8. **Smoke local**: `curl http://127.0.0.1:3000/` (en + pt), `/en/services`,
   `/api/health/live`.
9. **Proxy switch**: aponte o vhost do nginx para `127.0.0.1:3000` (ou
   porta escolhida) e recarregue — config real fora do escopo desta branch.
10. **Smoke público**: mesmo set de URLs via `https://<dominio>`.
11. **Monitor**: `docker compose -f docker-compose.prod.yml logs -f app`
    por alguns minutos; observe healthchecks.
12. **Rollback** se necessário (abaixo).

## Rollback

**APP rollback ≠ DATABASE rollback.** O app é stateless — rollback de
imagem é barato e seguro:

```bash
scripts/rollback-production.sh <sha-anterior>
```

Regras:

- Migrações são **forward-only**. Se uma migration já foi aplicada, NÃO
  improvise down migrations.
- Estratégia: (a) voltar à imagem anterior se compatível com o schema
  atual; (b) se o schema mudou de forma incompatível, o caminho é
  **forward fix** — nova migration + nova imagem; (c) restore de backup
  apenas em desastre controlado (docs/backup-and-restore.md).
- Verifique no histórico do compose qual imagem rodava antes
  (`docker images felipe-design --format '{{.Tag}} {{.CreatedAt}}'`).
- A imagem anterior não é apagada no deploy; `docker image prune` só com
  cautela consciente.

## Scripts

- `scripts/deploy-production.sh <sha> [port]` — `set -euo pipefail`, SHA
  explícito obrigatório, valida env (nomes apenas), build + up + health,
  aborta em falha, mantém imagem anterior.
- `scripts/rollback-production.sh <sha> [port]` — idem, exige imagem
  existente local, health-check pós-rollback.

Ambos idempotentes e sem secrets hardcoded.