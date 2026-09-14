-- Migration 0005: fluxo do cliente de ponta a ponta
-- Pagamento simulado (mock), fila por fotos enviadas, revisao gratuita e seed de desenvolvimento.

-- Provedor de pagamento simulado (somente desenvolvimento; guardado por flag no backend).
alter type public.payment_provider add value if not exists 'mock';

-- ============ Novas colunas de orders ============

alter table public.orders add column if not exists paid_at timestamptz;
alter table public.orders add column if not exists source_image_count integer not null default 0;
alter table public.orders add column if not exists idempotency_key uuid;

create unique index if not exists orders_idempotency_uq
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- ============ Contagem de fotos enviadas ============

create or replace function public.sync_source_image_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
    set source_image_count = (
      select count(*) from public.order_images
      where order_id = coalesce(new.order_id, old.order_id)
        and kind = 'source'
    )
    where id = coalesce(new.order_id, old.order_id);
  return null;
end;
$$;

drop trigger if exists order_images_sync_count on public.order_images;

create trigger order_images_sync_count
  after insert or delete on public.order_images
  for each row execute function public.sync_source_image_count();

-- ============ Backlog: apenas pedidos prontos para producao ============
-- Regra: consome capacidade somente pedido pago com todas as fotos enviadas.
-- Decisao documentada em docs/queue-and-deadline.md.

create or replace function public.current_backlog_images()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(total_images), 0)
  from public.orders
  where status in ('pending', 'in_progress')
    and paid_at is not null
    and source_image_count >= total_images;
$$;

-- ============ Estimativa publica de prazo ============
-- Recriada com o novo backlog; anon pode estimar antes do login (vitrine).

create or replace function public.estimate_delivery(p_new_images integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.app_settings;
  v_today date;
  v_start date;
  v_backlog integer;
  v_days integer;
begin
  if p_new_images is null or p_new_images < 1 then
    raise exception 'INVALID_IMAGES';
  end if;

  select * into v_settings from public.app_settings where id = 1;

  v_today := (now() at time zone v_settings.timezone)::date;

  if ((now() at time zone v_settings.timezone)::time >= v_settings.cutoff_time::time)
     or not public.is_business_day(v_today) then
    v_start := public.next_business_day(v_today);
  else
    v_start := v_today;
  end if;

  v_backlog := public.current_backlog_images();

  v_days := ceil((v_backlog + p_new_images)::numeric / v_settings.daily_capacity)::integer;

  return json_build_object(
    'startsCountingFrom', to_char(v_start, 'YYYY-MM-DD'),
    'businessDaysNeeded', v_days,
    'promisedDeliveryDate', to_char(public.add_business_days(v_start, v_days - 1), 'YYYY-MM-DD')
  );
end;
$$;

revoke execute on function public.estimate_delivery(integer) from public, anon;
grant execute on function public.estimate_delivery(integer) to anon, authenticated, service_role;

-- ============ create_order com idempotencia ============

drop function if exists public.create_order(uuid, integer, public.currency, text);

create or replace function public.create_order(
  p_plan_id uuid,
  p_knife_quantity integer,
  p_currency public.currency,
  p_affiliate_code text default null,
  p_idempotency_key uuid default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.app_settings;
  v_plan public.plans;
  v_price public.plan_prices;
  v_today date;
  v_start date;
  v_backlog integer;
  v_days integer;
  v_total_images integer;
  v_promised date;
  v_affiliate public.affiliates;
  v_order public.orders;
  v_amount integer;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Idempotencia: a mesma chave devolve o pedido ja criado (double-click, retry).
  if p_idempotency_key is not null then
    select * into v_order from public.orders
    where idempotency_key = p_idempotency_key and user_id = auth.uid();
    if v_order.id is not null then
      return v_order;
    end if;
  end if;

  if p_knife_quantity < 1 or p_knife_quantity > 100 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- Lock serializador: pedidos simultaneos entram na fila de forma consistente.
  select * into v_settings from public.app_settings where id = 1 for update;

  select * into v_plan from public.plans
  where id = p_plan_id and active;
  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  v_today := (now() at time zone v_settings.timezone)::date;

  select * into v_price from public.plan_prices
  where plan_id = p_plan_id
    and currency = p_currency
    and active
    and valid_from <= v_today
    and (valid_until is null or valid_until >= v_today)
  order by valid_from desc
  limit 1;
  if not found then
    raise exception 'PRICE_NOT_FOUND';
  end if;

  v_total_images := p_knife_quantity * v_plan.angles;

  if ((now() at time zone v_settings.timezone)::time >= v_settings.cutoff_time::time)
     or not public.is_business_day(v_today) then
    v_start := public.next_business_day(v_today);
  else
    v_start := v_today;
  end if;

  v_backlog := public.current_backlog_images();

  v_days := ceil((v_backlog + v_total_images)::numeric / v_settings.daily_capacity)::integer;
  v_promised := public.add_business_days(v_start, v_days - 1);

  if p_affiliate_code is not null and btrim(p_affiliate_code) <> '' then
    select * into v_affiliate from public.affiliates
    where code = upper(btrim(p_affiliate_code)) and active;
  end if;

  v_amount := v_price.amount_cents * p_knife_quantity;

  begin
    insert into public.orders (
      user_id, plan_id, knife_quantity, total_images, currency,
      unit_price_cents, subtotal_cents, total_cents,
      status, promised_delivery_date, affiliate_id, idempotency_key
    ) values (
      auth.uid(), v_plan.id, p_knife_quantity, v_total_images, p_currency,
      v_price.amount_cents, v_amount, v_amount,
      'pending', v_promised, v_affiliate.id, p_idempotency_key
    )
    returning * into v_order;
  exception
    when unique_violation then
      -- Requisicoes concorrentes com a mesma chave: devolve o pedido ja criado.
      select * into v_order from public.orders
      where idempotency_key = p_idempotency_key and user_id = auth.uid();
      if v_order.id is null then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
  end;

  return v_order;
end;
$$;

revoke execute on function public.create_order(uuid, integer, public.currency, text, uuid) from public, anon;
grant execute on function public.create_order(uuid, integer, public.currency, text, uuid) to authenticated, service_role;

-- ============ Registro de intencao de pagamento ============
-- Espelha o futuro fluxo real: o gateway cria a intencao e o webhook confirma.

create or replace function public.record_payment_intent(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_external_payment_id text,
  p_amount_cents integer,
  p_currency public.currency
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_payment public.payments;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if auth.uid() is not null and auth.uid() <> v_order.user_id and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.payments (
    order_id, provider, external_payment_id, status, amount_cents, currency
  ) values (
    p_order_id, p_provider, p_external_payment_id, 'pending', p_amount_cents, p_currency
  )
  on conflict (provider, external_payment_id) do update
    set updated_at = now()
  returning * into v_payment;

  return v_payment;
end;
$$;

revoke execute on function public.record_payment_intent(uuid, public.payment_provider, text, integer, public.currency) from public, anon;
grant execute on function public.record_payment_intent(uuid, public.payment_provider, text, integer, public.currency) to authenticated, service_role;

-- ============ Confirmacao de pagamento ============
-- Mesma funcao que um webhook real (Stripe/Mercado Pago/NowPayments) chamara.
-- Idempotente por evento e por pagamento; o prazo vira snapshot definitivo na
-- primeira confirmacao e nunca e recalculado depois.

create or replace function public.confirm_order_payment(
  p_order_id uuid,
  p_provider public.payment_provider,
  p_external_payment_id text,
  p_provider_event_id text,
  p_amount_cents integer,
  p_currency public.currency
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_settings public.app_settings;
  v_today date;
  v_start date;
  v_backlog integer;
  v_days integer;
  v_promised date;
  v_event_seen boolean;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if auth.uid() is not null and auth.uid() <> v_order.user_id and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Evento repetido nao gera efeito duplicado.
  select exists (
    select 1 from public.payment_events
    where provider = p_provider and provider_event_id = p_provider_event_id
  ) into v_event_seen;

  if not v_event_seen then
    insert into public.payment_events (provider, provider_event_id, payload)
    values (p_provider, p_provider_event_id, jsonb_build_object(
      'order_id', p_order_id,
      'external_payment_id', p_external_payment_id,
      'amount_cents', p_amount_cents,
      'currency', p_currency
    ))
    on conflict (provider, provider_event_id) do nothing;
  end if;

  -- Pagamento idempotente por (provider, external_payment_id).
  insert into public.payments (
    order_id, provider, external_payment_id, provider_event_id,
    status, amount_cents, currency, raw_metadata
  ) values (
    p_order_id, p_provider, p_external_payment_id, p_provider_event_id,
    'paid', p_amount_cents, p_currency, jsonb_build_object('order_id', p_order_id)
  )
  on conflict (provider, external_payment_id) do update
    set status = 'paid',
        provider_event_id = excluded.provider_event_id,
        updated_at = now();

  -- Primeira confirmacao: grava paid_at e o snapshot definitivo do prazo.
  if v_order.paid_at is null then
    select * into v_settings from public.app_settings where id = 1 for update;

    v_today := (now() at time zone v_settings.timezone)::date;
    if ((now() at time zone v_settings.timezone)::time >= v_settings.cutoff_time::time)
       or not public.is_business_day(v_today) then
      v_start := public.next_business_day(v_today);
    else
      v_start := v_today;
    end if;

    v_backlog := public.current_backlog_images();

    v_days := ceil((v_backlog + v_order.total_images)::numeric / v_settings.daily_capacity)::integer;
    v_promised := public.add_business_days(v_start, v_days - 1);

    update public.orders
      set paid_at = now(),
          promised_delivery_date = greatest(v_order.promised_delivery_date, v_promised),
          updated_at = now()
      where id = p_order_id
      returning * into v_order;
  end if;

  return v_order;
end;
$$;

revoke execute on function public.confirm_order_payment(uuid, public.payment_provider, text, text, integer, public.currency) from public, anon;
grant execute on function public.confirm_order_payment(uuid, public.payment_provider, text, text, integer, public.currency) to authenticated, service_role;

-- ============ Revisao gratuita (1 rodada apos a primeira entrega) ============

create or replace function public.request_order_revision(
  p_order_id uuid,
  p_notes text
)
returns public.order_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_revision public.order_revisions;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if auth.uid() is null or auth.uid() <> v_order.user_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'ORDER_NOT_COMPLETED';
  end if;

  if not exists (
    select 1 from public.order_images
    where order_id = p_order_id and kind = 'result'
  ) then
    raise exception 'NO_DELIVERY_YET';
  end if;

  if exists (select 1 from public.order_revisions where order_id = p_order_id) then
    raise exception 'REVISION_ALREADY_REQUESTED';
  end if;

  if p_notes is null or btrim(p_notes) = '' then
    raise exception 'INVALID_NOTES';
  end if;
  if length(p_notes) > 2000 then
    raise exception 'NOTES_TOO_LONG';
  end if;

  insert into public.order_revisions (order_id, round, status, notes)
  values (p_order_id, 1, 'requested', btrim(p_notes))
  returning * into v_revision;

  -- A revisao retorna o pedido para producao.
  update public.orders
    set status = 'in_progress', updated_at = now()
    where id = p_order_id;

  return v_revision;
end;
$$;

revoke execute on function public.request_order_revision(uuid, text) from public, anon;
grant execute on function public.request_order_revision(uuid, text) to authenticated, service_role;

-- ============ Insercao de resultados pelo admin ============

-- O admin envia as entregas finais; as policies de storage ja restringem o bucket.
create policy order_images_insert_admin on public.order_images
  for insert with check (public.is_admin());

-- ============ Seed de desenvolvimento ============
-- Valores ficticios para testar localmente; substituiveis pelo painel
-- (/dashboard/plans) sem alterar codigo.

insert into public.plans (angles, active)
values (1, true), (2, true), (3, true)
on conflict (angles) do nothing;

insert into public.plan_prices (plan_id, currency, amount_cents, valid_from, active)
select p.id, seed.currency, seed.amount, current_date, true
from public.plans p
join (
  values
    (1, 'BRL'::public.currency, 7500),
    (2, 'BRL'::public.currency, 13000),
    (3, 'BRL'::public.currency, 18000),
    (1, 'USD'::public.currency, 3500),
    (2, 'USD'::public.currency, 6000),
    (3, 'USD'::public.currency, 8500)
) as seed(angles, currency, amount) on seed.angles = p.angles
on conflict (plan_id, currency, valid_from) do nothing;

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;
