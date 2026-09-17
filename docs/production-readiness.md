# Production Readiness Plan

Current status:
MVP COMPLETE — v0.2.0-mvp (main @ 06878ba)

Production Ready:
NOT YET

Este documento é o resultado da auditoria de production readiness (2026-09-16,
branch `chore/production-readiness`). Nada foi executado em infraestrutura:
somente auditoria de código e plano.

## Resumo da auditoria

| Área | Status | Observação |
|---|---|---|
| Env/config | READY (com ressalvas) | 5 vars mapeadas; sem secrets commitados |
| Supabase migrations | PARTIAL | 0009 contém exclusão de fixture DEV por UUID hardcoded; seed de 0005 insere preços fictícios em PROD |
| Auth | PARTIAL | URLs de redirect dependem de `window.location.origin`; precisa config de domínio no dashboard |
| Storage | PARTIAL | Buckets/policies criados via migration; limites de tamanho só no client + RPC |
| Payments | BLOCKER | Apenas mock provider; nenhum gateway real implementado; sem webhook route |
| Email | PARTIAL | Magic Link usa template default do Supabase; sem domínio/SMTP custom |
| Vercel | PARTIAL | App padrão Next 15; requer env vars + região; sem arquivo vercel-specific |
| Observability | BLOCKER | Zero error tracking, alertas, backups testados, rate limiting |

## Variáveis de ambiente (mapeamento)

| Nome | Classificação | PROD |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase / browser-public | Necessária (URL do projeto PROD) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase / browser-public | Necessária |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase / server-secret | Necessária (nunca no client) |
| `NEXT_PUBLIC_SITE_URL` | browser-public (SEO/redirects) | Necessária (URL real do domínio) |
| `ENABLE_MOCK_PAYMENTS` | payment / DEV-only | Em PROD: ausente ou `false` (o mock só é registrado quando `true`) |
| `E2E_BASE_URL` | test-only | Não definir em PROD |

CI (`.github/workflows/ci.yml`) usa apenas Supabase + mock flag; nenhum
segredo novo será necessário para CI de PROD, apenas eventual rotação.

## Auditoria de migrations (Supabase)

| Migration | Classificação | Nota |
|---|---|---|
| 0001 schema | SAFE FOR PROD | Sem dados DEV; índices/constraints sólidos |
| 0002 rls_and_security | SAFE FOR PROD | RLS em todas as tabelas; trigger de profile; buckets criados idempotentemente |
| 0003 queue_rpc_and_seed | REVIEW REQUIRED | Seed de plans/app_settings é operacional (OK), mas cria `create_order` sem idempotency — substituída em 0005/0008, ok em sequência |
| 0004 admin_rpc | SAFE FOR PROD | RPCs admin com guard `is_admin()` + revoke de anon |
| 0005 customer_flow | REVIEW REQUIRED | Adiciona enum `mock` ao tipo `payment_provider` (permanece em PROD — inofensivo mas não removível) e insere seed de PREÇOS FICTÍCIOS (R$75/130/180, USD 35/60/85) — em um banco PROD vazio eles simplesmente não existem; os preços devem ser criados pelo painel admin antes do lançamento |
| 0006 production_ready_queue | SAFE FOR PROD | Refatora confirm_order_payment p/ maybe_mark_order_ready |
| 0007 promised_delivery_nullable | SAFE FOR PROD | Idempotente (DO block com verificação) |
| 0008 source_photo_intake | SAFE FOR PROD | Snapshots de política por pedido; RPC transacional |
| 0009 backfill_legacy_source_knife_index | **BLOCKER → REVISar antes do db push em PROD** | Contém guarda `LEGACY_MULTI_KNIFE_SOURCE_ROWS` que apenas VERIFICA (não falha em banco vazio), e `DELETE` de um UUID de fixture DEV. Em banco PROD vazio: os deletes afetam 0 rows e as guardas passam — **é tecnicamente segura para rodar em banco vazio**, mas o DELETE hardcoded por UUID é padrão DEV que não deve ser replicado em futuras migrations. Classificação final: SAFE FOR PROD (banco vazio) com REVIEW REQUIRED para manter a prática documentada. |
| 0010 source_image_authority | SAFE FOR PROD | Fecha bypass de insert direto de source |
| 0011 register_source_image_replay | SAFE FOR PROD | Idempotência por storage_path |

Conclusão 0009: em um banco PROD **vazio**, os `DELETE`s não encontram rows
(UUID de fixture DEV não existirá) e as guardas `DO $$` passam com count 0.
É segura de executar, mas deve ser acompanhada durante o primeiro `db push`.

## PHASE 1 — Production infrastructure

- [ ] Criar conta/organização Vercel PROD (ação humana)
- [ ] Definir domínio de produção e registrar DNS base (ação humana; não apontar ainda)
- [ ] Decidir região de deploy (recomendado: mesma região do Supabase PROD, ex. `gru1`/São Paulo) 
- [ ] PASS: domínio reservado, região decidida

## PHASE 2 — Supabase PROD

**Status (2026-09-17): CONCLUÍDO até a aplicação de migrations e validação.**

- [x] Criar projeto Supabase PROD (ação humana)
  - Project name: `felipe-design-prod`
  - Project ref: `xwsghpzvbiguvnvwiuoq`
  - Region: `sa-east-1` (South America / São Paulo)
  - Status: ACTIVE_HEALTHY
- [ ] Anotar `SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY` do projeto PROD (para a fase Vercel)
- [x] `supabase link --project-ref xwsghpzvbiguvnvwiuoq` — CURRENT LINK = PROD
- [x] `supabase db push` aplicando 0001–0011 em banco vazio confirmado
  - Todas as 11 migrations aplicadas com sucesso (nenhuma falha)
  - Migration 0009: DELETEs de fixture DEV afetaram **0 rows** (como previsto pela auditoria); guards passaram; constraint `order_images_source_requires_knife` validada
- [x] Validação de schema: tabelas core presentes (profiles, plans, plan_prices, orders, order_images, order_revisions, payments, payment_events, affiliates, affiliate_commissions, portfolio_items, app_settings); colunas de source photo intake confirmadas (knife_index em order_images; snapshots + source_photos_submitted_at + production_ready_at + paid_at em orders)
- [x] Validação de RLS: rowsecurity=true em todas as tabelas public; policies presentes por tabela
- [x] Validação de RPCs: todas as 22 funções presentes (create_order, register_source_image, delete_source_image, submit_source_photos, update_app_settings, confirm_order_payment, record_payment_intent, maybe_mark_order_ready, estimate_delivery, set_*, request_order_revision, is_admin, helpers de fila e triggers)
- [x] Validação de Storage: buckets `client-uploads` (PRIVATE), `order-results` (PRIVATE), `portfolio` (public)
- [x] Verificar buckets `client-uploads` (private), `order-results` (private), `portfolio` (public) criados pela 0002
- [x] `app_settings` validado (defaults): daily_capacity=4, cutoff_time=17:00, timezone=America/Sao_Paulo, min_source_photos_per_knife=3, max_source_photos_per_knife=5, max_source_photo_size_mb=25
- [ ] Configurar preços reais via `/dashboard/plans` — **PENDING ADMIN CONFIGURATION** (os valores atuais em `plan_prices` são fixtures da seed da 0005, não preços reais)
- [ ] Configurar `app_settings` (capacidade, cutoff, min/max fotos) via dashboard — conferir valores reais antes do lançamento
- [ ] Criar primeiro usuário admin — **PENDING HUMAN ACTION** (magic link + `update public.profiles set role='admin'` via SQL Editor)
- [ ] Auth: Site URL e Redirect URLs de produção — **PENDING VERCEL/DOMAIN PHASE**
- [ ] PASS: `select count(*) from public.plans;` = 3; admin consegue logar no dashboard; buckets listados

## PHASE 3 — Vercel / domain / auth / email

- [ ] Importar repositório no Vercel; Node 22 (usar engines `>=20`, CI usa 22)
- [ ] Configurar env vars de produção (tabela acima; `ENABLE_MOCK_PAYMENTS` ausente)
- [ ] Adicionar domínio custom no Vercel; apontar DNS (ação humana)
- [ ] No Supabase PROD Auth: Site URL = domínio real; Redirect URLs incluem `https://<dominio>/**`
- [ ] Verificar magic link fluindo com locale preservado (`window.location.origin` cobre o domínio automaticamente)
- [ ] Opcional mas recomendado: SMTP custom (Resend/Postmark) + domínio remetente + SPF/DKIM/DMARC
- [ ] PASS: magic link chega por e-mail no domínio real; login redireciona para account/dashboard

## PHASE 4 — Real payments

- [ ] Escolher gateway (Stripe / Mercado Pago / NowPayments — enum já suporta)
- [ ] Implementar provider concreto no registry (`src/services/payment-providers.ts`)
- [ ] Criar rota de webhook (`/api/webhooks/<provider>`) chamando `confirm_order_payment` com verificação de assinatura
- [ ] Variáveis de API keys do gateway (server-secret)
- [ ] Testar ciclo: intent → checkout → webhook → `paid_at` + fila
- [ ] PASS: pedido de teste pago com cartão de sandbox entra em production_ready

## PHASE 5 — Observability / backups / security

- [ ] Error tracking (ex. Sentry) — REQUIRED BEFORE LAUNCH
- [ ] Uptime monitoring (BetterStack/UptimeRobot no domínio) — REQUIRED BEFORE LAUNCH
- [ ] Verificar backups automáticos do Supabase (PITR) + teste de restore — REQUIRED BEFORE LAUNCH
- [ ] Alertas de falha de webhook de pagamento — RECOMMENDED
- [ ] Rate limiting no endpoint de login/OTP (Supabase Auth já limita; revisar) — RECOMMENDED
- [ ] Security headers (HSTS, CSP) via `next.config.ts` — RECOMMENDED
- [ ] Limpeza de orphans de Storage (objetos sem row em order_images) — POST-LAUNCH
- [ ] PASS: alerta de teste dispara; backup restaurável em projeto staging

## PHASE 6 — Production smoke tests

- [ ] Fluxo completo com usuário de teste: login → checkout → upload → submit → admin entrega → revisão
- [ ] Verificar RLS: cliente A não vê pedido do cliente B
- [ ] Verificar queue: promessa de prazo correta após pagamento+fotos
- [ ] Verificar i18n `/pt/servicos` etc. no domínio real
- [ ] PASS: E2E crítico executado manualmente em PROD com dados de teste removidos

## PHASE 7 — Launch

- [ ] Congelar preços e configurações
- [ ] Anúncio/abertura de vendas (ação humana)
- [ ] Monitorar primeiras 48h (erros, webhooks, uploads)
- [ ] PASS: 48h sem incidentes bloqueantes

## Ações que exigem intervenção humana

1. Criar projetos Supabase PROD e Vercel (pagamentos, região)
2. Registrar domínio e apontar DNS
3. Promover o primeiro admin (SQL manual)
4. Configurar preços reais no dashboard
5. Escolher e credenciar gateway de pagamento (fase 4)
6. Configurar SMTP/domínio de e-mail se desejado

## Notas de segurança (estado atual)

- RLS ativa em todas as tabelas; RPCs SECURITY DEFINER têm guards (`is_admin`, ownership) e `search_path = public` fixado — bom.
- `register_source_image` é a única via de insert de source (0010) — bom.
- Limites de source photo upload: validação em três camadas — client (MIME), snapshot por pedido e verificação server-side no finalize (objeto real consultado no Storage: existência, tamanho e MIME comparados ao snapshot do pedido; falhas disparam cleanup de orphan). O Storage em si não enforce tamanho, mas o finalize rejeita e remove objetos fora da política.
- Sem rate limiting próprio de aplicação além do Supabase — RECOMMENDED antes do lançamento.