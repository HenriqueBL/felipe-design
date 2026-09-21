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

## Multi-item orders e carrinho (migration 0017)

- `order_items`: uma row por linha de carrinho (plan × knife_quantity). Colunas: `order_id`, `item_index` (1..n), `plan_id`, `knife_quantity`, `angles` (snapshot), `unit_price_cents`, `subtotal_cents`, `total_images`, `knife_index_start`. Cada item possui um range global de facas `[knife_index_start, knife_index_start + knife_quantity - 1]`; `order_images.knife_index` continua sendo um índice global único (1..`orders.knife_quantity`). Constraints: `order_items_subtotal_matches` (subtotal = unitário × qty), `order_items_images_matches` (total_images = qty × angles), unicidade por `(order_id, item_index)` e `(order_id, knife_index_start)`.
- `orders.plan_id` agora é nullable: pedidos multi-item não têm um único plano; pedidos legados e single-item continuam preenchendo a coluna. As constraints `orders_subtotal_matches` e `orders_total_matches` foram removidas (igualdade agora garantida transacionalmente no RPC e pelas checks por item).
- Backfill idempotente: todo pedido legado sem `order_items` recebe exatamente um item (item_index 1, knife_index_start 1) com snapshots copiados da própria ordem e ângulos do plano original.
- `create_cart_order(p_items jsonb, p_currency, p_affiliate_code?, p_idempotency_key?)` (auth): criação atômica de pedido multi-item. Valida 1..20 linhas, qty 1..100, planos ativos, preços vigentes; computa totais e total_images; insere order + items em uma transação. Idempotência por `(idempotency_key, user_id)` com retry-select em `unique_violation`. Códigos de erro: `NOT_AUTHENTICATED`, `INVALID_ITEMS`, `PLAN_NOT_FOUND`, `PRICE_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`.
- `register_source_image` (atualizado): valida `knife_index` contra ranges de `order_items` quando existem; fallback para check legado (1..`knife_quantity`) se não houver itens (defensivo — backfill garante que sempre existe pelo menos um item).
- RLS em `order_items`: select próprio ou admin (via join com `orders.user_id`); escrita apenas por RPCs `security definer`.

### Price snapshot consistency (migration 0018)

- `create_cart_order` reescrito para validar e materializar preços em uma temp table `_cart_validated_items` em uma única passagem. Order e items são inseridos exclusivamente a partir desse snapshot; não há segunda leitura de `plan_prices` após a criação do pedido. Isso elimina a janela de concorrência em que `orders.total_cents` poderia refletir um preço diferente de `order_items.subtotal_cents`.
- `orders.plan_id`: NULL para pedidos multi-item (>1 item); mantém o `plan_id` apenas para pedidos single-item. `order_items` é a autoridade exclusiva de composição; nenhum reader deve interpretar `orders.plan_id` como "o plano do pedido inteiro" quando existem múltiplos itens.

### Aggregate knife limit guard (migration 0019)

- `create_cart_order` agora valida `v_total_knives <= 100` antes de qualquer escrita, levantando `INVALID_ITEMS` se o total agregado exceder o limite. Isso alinha o RPC com a constante `CART_MAX_TOTAL_KNIVES = 100` em `src/domain/cart.ts` e evita erros genéricos de CHECK constraint no banco. O frontend (`addToCart`/`updateQuantity` em `cart-store.ts`) rejeita deterministicamente operações que excederiam o limite, preservando itens existentes sem mutação silenciosa; `normalizeCart` é puramente estrutural (deduplicação e cap por item).

## Segurança adicional

- Service role nunca chega ao frontend; clientes admin existem apenas em código server-side.
- `security definer` com `set search_path = public` em todas as funções.
- Execução das RPCs administrativas revogada de `anon` e concedida a `authenticated`.
