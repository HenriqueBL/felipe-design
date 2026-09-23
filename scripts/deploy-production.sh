#!/usr/bin/env bash
# Deploy de producao do Felipe Design (VPS + Docker Compose).
# Requer SHA explicito (sem branch flutuante). Migrations NAO sao
# automatizadas aqui: `supabase db push` e sempre um passo manual e
# consciente — ver docs/production-deploy.md.
#
# Uso (na VPS, dentro do checkout do repo):
#   scripts/deploy-production.sh <git-sha> [app-port]

set -euo pipefail

SHA="${1:?Usage: deploy-production.sh <git-sha> [app-port]}"
APP_PORT="${2:-3000}"
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE="felipe-design:${SHA}"
ENV_FILE=".env.production"
BASE_URL="http://127.0.0.1:${APP_PORT}"

# ── Gate tracking ──────────────────────────────────────────────────────
# Cada gate registra PASS/FAIL. O deploy so imprime SUCCESS se todos
# os gates obrigatorios passarem.
BUILD_STATUS="NOT_RUN"
ENV_STATUS="NOT_RUN"
DEPLOY_STATUS="NOT_RUN"
HEALTH_STATUS="NOT_RUN"
SMOKE_STATUS="NOT_RUN"

print_report() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  DEPLOY REPORT"
  echo "═══════════════════════════════════════════════════════"
  echo "  BUILD:   ${BUILD_STATUS}"
  echo "  ENV:     ${ENV_STATUS}"
  echo "  DEPLOY:  ${DEPLOY_STATUS}"
  echo "  HEALTH:  ${HEALTH_STATUS}"
  echo "  SMOKE:   ${SMOKE_STATUS}"
  echo "───────────────────────────────────────────────────────"
  if [[ "$BUILD_STATUS" == "PASS" && \
        "$ENV_STATUS" == "PASS" && \
        "$DEPLOY_STATUS" == "PASS" && \
        "$HEALTH_STATUS" == "PASS" && \
        "$SMOKE_STATUS" == "PASS" ]]; then
    echo "  FINAL:   SUCCESS"
    echo "═══════════════════════════════════════════════════════"
  else
    echo "  FINAL:   FAILED"
    echo "═══════════════════════════════════════════════════════"
  fi
}

trap print_report EXIT

[ -f "$COMPOSE_FILE" ] || { echo "ERROR: $COMPOSE_FILE not found"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found (see docs/production-deploy.md)"; exit 1; }

echo "==> Deploying $IMAGE"
git rev-parse --verify "$SHA^{commit}" >/dev/null 2>&1 \
  || { echo "ERROR: $SHA is not a valid git commit"; exit 1; }

# ── BUILD ──────────────────────────────────────────────────────────────
echo "==> Building image"
# Extrai SOMENTE as vars NEXT_PUBLIC permitidas do .env.production e passa
# como build args públicos (necessárias durante `next build`). Nenhum secret
# nunca é passado ao docker build.
read_env_value() {
  grep -E "^${1}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '\r' || true
}
PUBLIC_BUILD_ARGS=(
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=$(read_env_value NEXT_PUBLIC_SUPABASE_URL)"
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(read_env_value NEXT_PUBLIC_SUPABASE_ANON_KEY)"
  --build-arg "NEXT_PUBLIC_SITE_URL=$(read_env_value NEXT_PUBLIC_SITE_URL)"
)

# Verifica se ja existe imagem com esta tag e compara digest para evitar
# ambiguidade silenciosa (mesmo SHA, conteudo diferente).
EXISTING_IMAGE_ID=""
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  EXISTING_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
  echo "==> WARNING: image $IMAGE already exists (id: ${EXISTING_IMAGE_ID:0:19})"
  echo "==> Rebuilding will overwrite this tag. Previous image remains as dangling."
fi

if git archive "$SHA" | docker build "${PUBLIC_BUILD_ARGS[@]}" -t "$IMAGE" -; then
  BUILD_STATUS="PASS"
else
  BUILD_STATUS="FAIL"
  exit 1
fi

# Registra image ID/digest no relatorio para auditoria pos-build.
NEW_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
echo "==> Built image: $IMAGE (id: ${NEW_IMAGE_ID:0:19})"
if [[ -n "$EXISTING_IMAGE_ID" && "$EXISTING_IMAGE_ID" != "$NEW_IMAGE_ID" ]]; then
  echo "==> NOTE: image was rebuilt — previous id ${EXISTING_IMAGE_ID:0:19} replaced by ${NEW_IMAGE_ID:0:19}"
fi

# ── ENV VALIDATION ─────────────────────────────────────────────────────
echo "==> Validating env (names only, never values)"
if docker run --rm --env-file "$ENV_FILE" -e NODE_ENV=production "$IMAGE" \
  node scripts/validate-production-env.mjs; then
  ENV_STATUS="PASS"
else
  ENV_STATUS="FAIL"
  exit 1
fi

# ── DEPLOY (start container) ──────────────────────────────────────────
echo "==> Starting new version"
if APP_IMAGE="$IMAGE" APP_PORT="$APP_PORT" \
  docker compose -f "$COMPOSE_FILE" up -d; then
  DEPLOY_STATUS="PASS"
else
  DEPLOY_STATUS="FAIL"
  exit 1
fi

# ── HEALTH CHECK ───────────────────────────────────────────────────────
echo "==> Waiting for health"
HEALTH_OK=false
for i in $(seq 1 30); do
  if curl -fsS "$BASE_URL/api/health/live" >/dev/null 2>&1; then
    echo "==> Health OK after ${i} checks"
    HEALTH_OK=true
    break
  fi
  sleep 2
done

if [[ "$HEALTH_OK" != "true" ]]; then
  HEALTH_STATUS="FAIL"
  echo "ERROR: health check failed. Inspect logs:"
  echo "  docker compose -f $COMPOSE_FILE logs --tail=50 app"
  exit 1
fi
HEALTH_STATUS="PASS"

# ── SMOKE TESTS ───────────────────────────────────────────────────────
# Testa rotas publicas criticas. Qualquer falha acumula e o deploy
# termina com exit 1. Nao mata no primeiro erro — testa todas as rotas
# para dar visibilidade completa do que esta quebrado.
#
# Codigo esperado por rota:
#   200 — pagina publica normal
#   307/308 — redirect esperado (root / redireciona para locale)
#   Qualquer outro codigo (404, 500, 502, 503, redirect inesperado) = FAIL

SMOKE_FAILURES=0

# smoke_check <label> <path> <expected_codes...>
# Exemplo: smoke_check "HOME_ROOT" "/" 307 308
#          smoke_check "SERVICES_EN" "/en/services" 200
smoke_check() {
  local label="$1"
  local path="$2"
  shift 2
  local expected_codes=("$@")

  # curl -o /dev/null descarta body; -s silencia progresso;
  # -w '%{http_code}' imprime apenas o status code.
  # --max-time evita hang infinito em rota travada.
  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}${path}" 2>/dev/null)" || http_code="000"

  local matched=false
  for code in "${expected_codes[@]}"; do
    if [[ "$http_code" == "$code" ]]; then
      matched=true
      break
    fi
  done

  if [[ "$matched" == "true" ]]; then
    echo "  SMOKE_PASS: ${label} (${path}) => ${http_code}"
  else
    echo "  SMOKE_FAIL: ${label} (${path}) => ${http_code} (expected: ${expected_codes[*]})"
    SMOKE_FAILURES=$((SMOKE_FAILURES + 1))
  fi
}

echo "==> Running smoke tests"

# ROOT — Next.js App Router com [locale] segment redireciona / para locale
smoke_check "ROOT"             "/"              307 308

# EN routes
smoke_check "HOME_EN"          "/en"            200
smoke_check "SERVICES_EN"      "/en/services"   200
smoke_check "ABOUT_EN"         "/en/about"      200
smoke_check "GALLERY_EN"       "/en/gallery"    200
smoke_check "CART_EN"          "/en/cart"       200
smoke_check "LOGIN_EN"         "/en/login"      200
smoke_check "CHECKOUT_EN"      "/en/checkout"   200

# PT routes (public paths reescritos via next.config.ts)
smoke_check "HOME_PT"          "/pt"            200
smoke_check "SERVICOS_PT"      "/pt/servicos"   200
smoke_check "SOBRE_PT"         "/pt/sobre"      200
smoke_check "GALERIA_PT"       "/pt/galeria"    200
smoke_check "CART_PT"          "/pt/cart"       200
smoke_check "CARRINHO_PT"      "/pt/carrinho"   200
smoke_check "LOGIN_PT"         "/pt/login"      200
smoke_check "FINALIZAR_PT"     "/pt/finalizar"  200

# System routes
smoke_check "HEALTH_LIVE"      "/api/health/live" 200
smoke_check "SITEMAP"          "/sitemap.xml"   200
smoke_check "ROBOTS"           "/robots.txt"    200

echo ""
if [[ "$SMOKE_FAILURES" -ne 0 ]]; then
  SMOKE_STATUS="FAIL"
  echo "PUBLIC_SMOKE: FAIL (${SMOKE_FAILURES} route(s) failed)"
  echo "==> Previous image kept on disk for rollback: scripts/rollback-production.sh <previous-sha>"
  exit 1
fi

SMOKE_STATUS="PASS"
echo "PUBLIC_SMOKE: PASS (all routes OK)"
echo "==> Previous image kept on disk for rollback: scripts/rollback-production.sh <previous-sha>"
exit 0