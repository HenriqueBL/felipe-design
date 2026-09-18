# syntax=docker/dockerfile:1

# Felipe Design — Next.js 15 production image (standalone output).
# Segredos NUNCA entram no build: NEXT_PUBLIC_* são runtime-arg-safe via
# runtime env, SUPABASE_SERVICE_ROLE_KEY entra apenas em runtime.
# Ver docs/production-deploy.md (build-time vs runtime).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* vazios no build: o app é stateless e lê essas vars em runtime
# via env do container (Next standalone injeta process.env no servidor).
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Validação fail-fast de env de produção (nomes apenas, nunca valores).
COPY --from=build --chown=nextjs:nodejs /app/scripts/validate-production-env.mjs ./scripts/validate-production-env.mjs
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "scripts/validate-production-env.mjs"]
CMD ["node", "server.js"]