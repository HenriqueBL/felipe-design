# Banco de dados - Felipe Design

> Migrations versionadas em `supabase/migrations`. Nomes em snake_case; aplicar com `supabase db push` ou SQL Editor na ordem 0001-0011.

## Enumerações

`user_role`, `currency`, `order_status`, `order_image_kind`, `revision_status`, `payment_provider`, `payment_status`, `commission_status`.

## Tabelas (migration 0001)

- `profiles`: espelho de `auth.users` com `role` (admin/customer). Preenchido pelo trigger `on_auth_user_created` (0002).
- `plans`: 1, 2 ou 3 ângulos (`unique`), flag `active`.
- `plan_prices`: preço por plano e moeda com vigência (`valid_from`/`valid_until`, `active`). Histórico imutável: mudança de preço abre nova vigência e encerra a anterior.
- `orders`: snapshot de preço (`unit_price_cents`, `subtotal_cents`, `total_cents`), moeda, `promised_delivery_date`, status, afiliado de origem e datas. Constraints garantem total = unitário x quantidade.
- `order_images`: fotos enviadas (source) e entregues (result); caminho único por pedido.
- `order_revisions`: rodadas de revisão por pedido (`unique(order_id, round)`; round 1 gratuita).
- `portfolio_items`: pares Antes/Depois com `published` e `sort_order`.
- `payments`: idempotência por `unique(provider, external_payment_id)`; `raw_metadata` jsonb para eventos brutos.
- `payment_events`: log de webhooks; `unique(provider, provider_event_id)` evita processar evento repetido.
- `affiliates`: código exclusivo e comissão em basis points (0-10000), configurável.
- `affiliate_commissions`: snapshot do percentual e valor por venda (`unique(order_id)`: uma comissão por pedido).
- `app_settings`: singleton (id=1) com `daily_capacity`, `cutoff_time` (HH:MM validado), `timezone`, e (migrations 0008) `min_source_photos_per_knife`, `max_source_photos_per_knife`, `max_source_photo_size_mb`.

### Colunas do source photo intake (migrations 0008–0011)

- `orders`: snapshot por pedido de `required_source_photos_per_knife`, `max_source_photos_per_knife`, `max_source_photo_size_mb` (copiados de `app_settings` no `create_order`; imutáveis após a criação — mudanças admin afetam só pedidos novos) e `source_photos_submitted_at` (NULL = intake aberto; após submit explícito, intake read-only).
- `order_images`: `knife_index` (1..`knife_quantity`, obrigatório para `kind='source'`; constraint `order_images_source_requires_knife`). Source photos são INPUT; `total_images` segue como workload OUTPUT.
- Migration 0009: backfill determinístico de `knife_index` (legacy single-knife → 1); exclusão de fixture residual de teste aprovada pelo dono. Revisar antes de provisionar PROD (padrão específico do DEV, não replicar).
- Migration 0010: `register_source_image` é a única via de INSERT de source images pelo cliente (RLS bloqueia insert direto de `kind='source'`); DELETE do cliente apenas com intake aberto, via RPC `delete_source_image` (retorna `storage_path` para remoção no Storage).
- Migration 0011: `register_source_image` idempotente por `storage_path` (replay devolve a row existente; replay com `knife_index` diferente → `REPLAY_MISMATCH`).

Índices relevantes: pedidos por usuário/status/afiliado, preços ativos por plano+moeda, pagamentos por pedido e período, comissões por afiliado+status, portfólio publicado+ordem.

## RLS e políticas (migration 0002)

RLS ativado em todas as tabelas. Resumo das políticas:

- `profiles`: dono lê o próprio perfil; admin gerencia tudo.
- `plans` e `plan_prices`: leitura pública (ativos) para a vitrine; histórico e escrita só para admin.
- `orders`/`order_images`/`order_revisions`: cliente acessa apenas os próprios (via join com `orders.user_id`); escrita de status/entrega só para admin.
- `payments`: leitura pelo dono do pedido; escrita apenas via service role (webhooks futuros).
- `payment_events`, `affiliate_commissions`, `app_settings`: somente admin.
- `affiliates`: somente admin.

A função `public.is_admin()` (security definer, stable) centraliza a checagem de papel em todas as políticas.

## Storage (migration 0002)

Buckets: `client-uploads` e `order-results` **privados**; `portfolio` público. Convenção de caminho `{user_id}/{order_id}/...`. O browser envia source photos diretamente ao Supabase Storage via protocolo TUS (resumable) — os bytes não passam pelo Next/Vercel. O bucket `client-uploads` permanece privado; leitura de thumbnails/imagens é feita via **signed URLs** geradas server-side. O service role nunca chega ao browser.

## RPCs (migrations 0003 e 0004)

- `estimate_delivery(p_new_images)` (auth): estimativa de prazo pré-compra.
- `create_order(p_plan_id, p_knife_quantity, p_currency, p_affiliate_code)` (auth): criação atômica do pedido com preço vigente, snapshot e prazo; ver `docs/queue-and-deadline.md`.
- `set_plan_price`/`set_plan_active`/`set_order_status` (admin): operações administrativas com guarda `is_admin()`.
- `update_app_settings` (admin, 0008): também `min/max_source_photos_per_knife` e `max_source_photo_size_mb`; afeta apenas pedidos criados depois.

### RPCs do source photo intake (migrations 0008, 0010, 0011)

- `register_source_image(p_order_id, p_knife_index, p_storage_path, p_original_filename)` (auth): única via de registro de source images pelo cliente. Trava o pedido (`FOR UPDATE`), valida intake aberto, `knife_index` dentro de 1..`knife_quantity` e o máximo por faca; idempotente por `storage_path` (0011).
- `delete_source_image(p_image_id)` (auth): remove source photo com intake aberto; devolve `storage_path` para o cliente remover o objeto do Storage.
- `submit_source_photos(p_order_id)` (auth): finalização explícita do intake ("Finish photo submission"); exige o mínimo por faca em todas as facas; idempotente; chama `maybe_mark_order_ready`.
- `maybe_mark_order_ready` (0008): regra v3 de production-ready — ver `docs/queue-and-deadline.md`.

## Segurança adicional

- Service role nunca chega ao frontend; clientes admin existem apenas em código server-side.
- `security definer` com `set search_path = public` em todas as funções.
- Execução das RPCs administrativas revogada de `anon` e concedida a `authenticated`.
