#!/usr/bin/env bash
# Rollback de APLICACAO apenas (imagem anterior). O banco de dados e
# forward-only: NUNCA rode down migrations improvisadas. Ver
# docs/production-deploy.md (secao Rollback) antes de usar.
#
# Uso:
#   scripts/rollback-production.sh <git-sha-anterior> [app-port]

set -euo pipefail

SHA="${1:?Usage: rollback-production.sh <previous-git-sha> [app-port]}"
APP_PORT="${2:-3000}"
COMPOSE_FILE="docker-compose.prod.yml"
IMAGE="felipe-design:${SHA}"

[ -f "$COMPOSE_FILE" ] || { echo "ERROR: $COMPOSE_FILE not found"; exit 1; }

docker image inspect "$IMAGE" >/dev/null 2>&1 \
  || { echo "ERROR: image $IMAGE not present locally (build or pull it first)"; exit 1; }

echo "==> Rolling back to $IMAGE (app only; database is NOT rolled back)"
APP_IMAGE="$IMAGE" APP_PORT="$APP_PORT" \
  docker compose -f "$COMPOSE_FILE" up -d

echo "==> Waiting for health"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health/live" >/dev/null 2>&1; then
    echo "==> Rollback OK and healthy after ${i} checks"
    exit 0
  fi
  sleep 2
done

echo "ERROR: health check failed after rollback. Inspect:"
docker compose -f "$COMPOSE_FILE" logs --tail=50 app || true
exit 1
