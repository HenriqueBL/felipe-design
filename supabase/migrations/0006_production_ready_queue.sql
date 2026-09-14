-- Migration 0006: prazo definitivo so apos pagamento + fotos completas
-- Regra oficial: pedido so entra na fila (consome backlog) quando atinge
-- ready_for_production. Antes disso, promised_delivery_date permanece NULL
-- e o pedido nao ocupa capacidade real da fila.

-- ============ Novas colunas em orders ============

alter table public.orders add column if not exists production_ready_at timestamptz;

-- promised_delivery_date so e preenchido quando o pedido atinge ready_for_production.
-- A coluna precisa aceitar NULL na criacao do pedido (create_order insere null).
alter table public.orders alter column promised_delivery_date drop not null;

-- Backlog redefinido: apenas pedidos que ja estao prontos para producao.
-- Pedidos pagos mas sem fotos completas nao consomem capacidade.
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
    and production_ready_at is not null;
$$;

-- ============ Funcao central de ativacao da fila ============
-- Idempotente: calcula backlog, fixa promised_delivery_date e marca
-- production_ready_at apenas uma vez. Chamada por trigger no upload
-- e por confirm_order_payment quando as fotos ja estavam completas.

create or replace function public.maybe_mark_order_ready(p_order_id uuid)
returns void
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
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  -- Ja esta pronto ou nao cumpre pre-requisitos: nada a fazer.
  if v_order.production_ready_at is not null then
    return;
  end if;
  if v_order.paid_at is null then
    return;
  end if;
  if v_order.source_image_count < v_order.total_images then
    return;
  end if;

  -- Lock serializador: dois pedidos ficando ready simultaneamente
  -- recebem backlog consistente (mesma estrategia de create_order).
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
    set production_ready_at = now(),
        promised_delivery_date = v_promised,
        updated_at = now()
    where id = p_order_id
      and production_ready_at is null;
end;
$$;

revoke execute on function public.maybe_mark_order_ready(uuid) from public, anon;
grant execute on function public.maybe_mark_order_ready(uuid) to authenticated, service_role;

-- ============ Trigger no upload: ativa fila quando fotos completam ============

create or replace function public.try_activate_order_after_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.maybe_mark_order_ready(coalesce(new.order_id, old.order_id));
  return null;
end;
$$;

drop trigger if exists order_images_try_activate on public.order_images;

create trigger order_images_try_activate
  after insert or delete on public.order_images
  for each row execute function public.try_activate_order_after_upload();

-- ============ Ajuste em confirm_order_payment ============
-- Remove o calculo inline de prazo (agora delegado a maybe_mark_order_ready).
-- Apenas grava paid_at; o trigger de upload ou a chamada explicita abaixo
-- cuidam da entrada na fila quando as condicoes forem satisfeitas.

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

  -- Primeira confirmacao: grava paid_at. O prazo sera calculado por
  -- maybe_mark_order_ready se as fotos ja estiverem completas.
  if v_order.paid_at is null then
    update public.orders
      set paid_at = now(),
          updated_at = now()
      where id = p_order_id
      returning * into v_order;

    -- Tenta ativar imediatamente (caso fotos ja tenham sido enviadas antes do pagamento).
    perform public.maybe_mark_order_ready(p_order_id);

    -- Recarrega para retornar o estado atualizado.
    select * into v_order from public.orders where id = p_order_id;
  end if;

  return v_order;
end;
$$;

revoke execute on function public.confirm_order_payment(uuid, public.payment_provider, text, text, integer, public.currency) from public, anon;
grant execute on function public.confirm_order_payment(uuid, public.payment_provider, text, text, integer, public.currency) to authenticated, service_role;

-- ============ Ajuste em create_order ============
-- Promised delivery date nasce NULL; sera preenchido apenas quando o pedido
-- atingir ready_for_production. Estimativa comercial e calculada sob demanda
-- pela funcao estimate_delivery (nao persistida).

drop function if exists public.create_order(uuid, integer, public.currency, text, uuid);

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
  v_plan public.plans;
  v_price public.plan_prices;
  v_today date;
  v_total_images integer;
  v_affiliate public.affiliates;
  v_order public.orders;
  v_amount integer;
  v_settings public.app_settings;
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

  select * into v_plan from public.plans
  where id = p_plan_id and active;
  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  select * into v_settings from public.app_settings where id = 1;
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
      'pending', null, v_affiliate.id, p_idempotency_key
    )
    returning * into v_order;
  exception
    when unique_violation then
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

-- ============ Estimativa comercial (pre-compra) ============
-- Nao persiste prazo; retorna apenas dias uteis estimados apos envio completo
-- das fotos, baseado no backlog atual de pedidos ja em producao.

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
    'businessDaysAfterReady', v_days,
    'currentBacklogImages', v_backlog
  );
end;
$$;

revoke execute on function public.estimate_delivery(integer) from public, anon;
grant execute on function public.estimate_delivery(integer) to anon, authenticated, service_role;