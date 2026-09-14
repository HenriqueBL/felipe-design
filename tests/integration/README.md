# Integration Tests — Felipe Design

Testes de integração contra PostgreSQL/Supabase real que validam a lógica das migrations (RPCs, triggers, RLS, storage policies, locking).

## Pré-requisitos

### Opção A: Supabase Local (recomendado)

```bash
# Instalar Supabase CLI
npm install -g supabase

# Iniciar Supabase local (requer Docker)
supabase init
supabase start

# Copiar credenciais geradas
cp .env.example .env.test.local
# Preencher com os valores exibidos por `supabase status`
```

### Opção B: Projeto Supabase de Desenvolvimento

1. Crie um projeto em https://supabase.com/dashboard (NUNCA use produção)
2. Copie `.env.example` para `.env.test.local`
3. Preencha com as credenciais do projeto de desenvolvimento

## Variáveis obrigatórias em `.env.test.local`

```
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ENABLE_MOCK_PAYMENTS=true
```

## Aplicar migrations

```bash
npx supabase db push --db-url "$DATABASE_URL"
# Ou via dashboard SQL Editor: aplicar 0001 → 0006 em ordem
```

## Executar

```bash
npm run test:integration
```

Os testes falham imediatamente se `.env.test.local` não existir ou se as variáveis estiverem vazias, evitando execução acidental contra produção.

## O que é testado

- `create_order`: idempotência, validações, `promised_delivery_date` NULL na criação
- `confirm_order_payment`: grava `paid_at`, chama `maybe_mark_order_ready` se fotos completas
- `maybe_mark_order_ready`: ativação idempotente, cálculo de prazo, locking serializador
- Trigger `order_images_try_activate`: ativa fila quando upload completa fotos
- `current_backlog_images`: só conta pedidos com `production_ready_at IS NOT NULL`
- `estimate_delivery`: retorna `businessDaysAfterReady` sem data absoluta
- RLS: cliente A não acessa dados de cliente B (orders, images, revisions)
- Storage policies: upload restrito ao dono, admin full access
- Mock payment: flag `ENABLE_MOCK_PAYMENTS`, idempotência, proibição cross-user
- Concorrência: dois pedidos ficando ready simultaneamente disputam lock real
- Cutoff/timezone: ativação antes/depois do corte, fim de semana