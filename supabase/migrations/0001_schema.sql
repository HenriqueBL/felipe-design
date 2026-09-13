-- Migration 0001: schema inicial do Felipe Design
-- Executar via Supabase CLI (`supabase db push`) ou SQL Editor.
-- Enum, tabelas, constraints, indices e triggers de timestamp.

create extension if not exists pgcrypto;

-- ============ Enums ============

create type public.user_role as enum ('admin', 'customer');
create type public.currency as enum ('BRL', 'USD');
create type public.order_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
create type public.order_image_kind as enum ('source', 'result');
create type public.revision_status as enum ('requested', 'in_progress', 'completed');
create type public.payment_provider as enum ('stripe', 'mercadopago', 'nowpayments');
create type public.payment_status as enum ('pending', 'processing', 'paid', 'failed', 'refunded');
create type public.commission_status as enum ('pending', 'paid');

-- ============ Funcao auxiliar: updated_at ============

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============ Tabelas ============

-- Perfil do usuario (cliente ou admin), espelhando auth.users.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

-- Planos de edicao: 1, 2 ou 3 angulos por faca.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  angles smallint not null unique check (angles between 1 and 3),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- Afiliados: link/codigo exclusivo e comissao configuravel (basis points).
create table public.affiliates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  code text not null unique,
  commission_rate_basis_points integer not null default 0
    check (commission_rate_basis_points between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Preco vigente por plano e moeda (BRL/USD independentes).
-- Historico preservado: nunca atualizar linhas antigas usadas em pedidos.
create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  currency public.currency not null,
  amount_cents integer not null check (amount_cents >= 0),
  valid_from date not null default current_date,
  valid_until date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint plan_prices_no_overlap check (valid_until is null or valid_until >= valid_from)
);

create unique index plan_prices_validity_uq
  on public.plan_prices (plan_id, currency, valid_from);
create index plan_prices_current_lookup_idx
  on public.plan_prices (plan_id, currency)
  where active;

-- Pedidos: snapshot de preco e prazo prometido no momento da compra.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  knife_quantity smallint not null check (knife_quantity between 1 and 100),
  total_images integer not null check (total_images > 0),
  currency public.currency not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  status public.order_status not null default 'pending',
  promised_delivery_date date not null,
  affiliate_id uuid references public.affiliates(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_subtotal_matches check (subtotal_cents = unit_price_cents * knife_quantity),
  constraint orders_total_matches check (total_cents = subtotal_cents)
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_affiliate_idx on public.orders (affiliate_id);

-- Imagens do pedido: enviadas pelo cliente (source) e entregues (result).
create table public.order_images (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind public.order_image_kind not null,
  storage_path text not null,
  original_filename text,
  created_at timestamptz not null default now(),
  constraint order_images_path_uq unique (order_id, storage_path)
);

create index order_images_order_idx on public.order_images (order_id);

-- Rodadas de revisao: a primeira (round 1) e gratuita por pedido.
create table public.order_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  round smallint not null check (round >= 1),
  status public.revision_status not null default 'requested',
  notes text,
  created_at timestamptz not null default now(),
  constraint order_revisions_round_uq unique (order_id, round)
);

-- Comissoes de afiliados: snapshot do percentual aplicado na venda.
create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  commission_rate_basis_points integer not null
    check (commission_rate_basis_points between 0 and 10000),
  amount_cents integer not null check (amount_cents >= 0),
  status public.commission_status not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint affiliate_commissions_order_uq unique (order_id)
);

create index affiliate_commissions_affiliate_idx
  on public.affiliate_commissions (affiliate_id, status);

-- Itens do portfolio com pares Antes/Depois.
create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  before_storage_path text not null,
  after_storage_path text not null,
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index portfolio_items_published_idx
  on public.portfolio_items (published, sort_order);

-- Pagamentos: external_payment_id unico por provedor (idempotencia).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider public.payment_provider not null,
  external_payment_id text not null,
  provider_event_id text,
  status public.payment_status not null default 'pending',
  amount_cents integer not null check (amount_cents >= 0),
  currency public.currency not null,
  raw_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_external_id_uq unique (provider, external_payment_id)
);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create index payments_order_idx on public.payments (order_id);
create index payments_period_idx on public.payments (status, created_at desc);

-- Log de eventos de webhook: evento repetido nao gera efeito duplicado.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider public.payment_provider not null,
  provider_event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_events_uq unique (provider, provider_event_id)
);

-- Configuracoes operacionais: singleton (id fixo = 1).
create table public.app_settings (
  id integer primary key default 1 check (id = 1),
  daily_capacity integer not null default 4 check (daily_capacity between 1 and 1000),
  cutoff_time text not null default '17:00'
    check (cutoff_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();
