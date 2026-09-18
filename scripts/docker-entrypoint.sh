#!/bin/sh
set -eu

# Fail-fast env validation; names only, never values.
node /app/scripts/validate-production-env.mjs

exec "$@"
