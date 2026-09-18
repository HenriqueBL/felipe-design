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

[ -f "$COMPOSE_FILE" ] || { echo "ERROR: $COMPOSE_FILE not found"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERROR: $ENV_FILE not found (see docs/production-deploy.md)"; exit 1; }

echo "==> Deploying $IMAGE"
git rev-parse --verify "$SHA^{commit}" >/dev/null 2>&1 \
  || { echo "ERROR: $SHA is not a valid git commit"; exit 1; }

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
git archive "$SHA" | docker build "${PUBLIC_BUILD_ARGS[@]}" -t "$IMAGE" -

echo "==> Validating env (names only, never values)"
docker run --rm --env-file "$ENV_FILE" -e NODE_ENV=production "$IMAGE" \
  node scripts/validate-production-env.mjs

echo "==> Starting new version"
APP_IMAGE="$IMAGE" APP_PORT="$APP_PORT" \
  docker compose -f "$COMPOSE_FILE" up -d

echo "==> Waiting for health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health/live" >/dev/null 2>&1; then
    echo "==> Deploy OK and healthy after ${i} checks"
    echo "==> Previous image kept on disk for rollback: scripts/rollback-production.sh <previous-sha>"
    exit 0
  fi
  sleep 2
done

echo "ERROR: health check failed. Rolling back to previous running image is manual;"
echo "inspect logs first: docker compose -f $COMPOSE_FILE logs --tail=50 app"
exit 1
