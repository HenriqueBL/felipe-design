# Banco de dados - Felipe Design

> Migrations versionadas em `supabase/migrations`. Nomes em snake_case; aplicar com `supabase db push` ou SQL Editor na ordem 0001-0004.

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
- `app_settings`: singleton (id=1) com `daily_capacity`, `cutoff_time` (HH:MM validado), `timezone`.

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

Buckets: `client-uploads` e `order-results` privados; `portfolio` público. Convenção de caminho `{user_id}/{order_id}/...`; políticas permitem ao cliente autenticado inserir/ler apenas objetos sob a própria pasta. Resultados finais serão servidos por signed URLs quando o upload/download entrar em escopo.

## RPCs (migrations 0003 e 0004)

- `estimate_delivery(p_new_images)` (auth): estimativa de prazo pré-compra.
- `create_order(p_plan_id, p_knife_quantity, p_currency, p_affiliate_code)` (auth): criação atômica do pedido com preço vigente, snapshot e prazo; ver `docs/queue-and-deadline.md`.
- `set_plan_price`/`set_plan_active`/`update_app_settings`/`set_order_status` (admin): operações administrativas com guarda `is_admin()`.

## Segurança adicional

- Service role nunca chega ao frontend; clientes admin existem apenas em código server-side.
- `security definer` com `set search_path = public` em todas as funções.
- Execução das RPCs administrativas revogada de `anon` e concedida a `authenticated`.
