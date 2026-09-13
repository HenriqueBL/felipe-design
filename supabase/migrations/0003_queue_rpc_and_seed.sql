-- Migration 0003: motor de fila/prazo em SQL, RPC atomica de pedido e seed
-- A RPC serializa a criacao de pedidos com FOR UPDATE na linha de configuracoes,
-- garantindo que pedidos simultaneos nao recebam o mesmo slot de capacidade.

-- ============ Dias uteis (seg-sex; feriados futuros via dias bloqueados) ============

create or replace function public.is_business_day(d date)
returns boolean
language sql
immutable
as $$
  select extract(isodow from d) between 1 and 5;
$$;

create or replace function public.next_business_day(d date)
returns date
language plpgsql
immutable
as $$
declare
  v date := d + 1;
begin
  while not public.is_business_day(v) loop
    v := v + 1;
  end loop;
  return v;
end;
$$;

create or replace function public.add_business_days(d date, days integer)
returns date
language plpgsql
immutable
as $$
declare
  v date := d;
  remaining integer := days;
begin
  if days < 0 then
    raise exception 'days must be non-negative';
  end if;
  while remaining > 0 loop
    v := v + 1;
    if public.is_business_day(v) then
      remaining := remaining - 1;
    end if;
  end loop;
  return v;
end;
$$;

-- ============ Estimativa de prazo (pre-compra, leitura) ============

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
  if p_new_images < 1 then
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

  select coalesce(sum(total_images), 0) into v_backlog
  from public.orders
  where status in ('pending', 'in_progress');

  v_days := ceil((v_backlog + p_new_images)::numeric / v_settings.daily_capacity)::integer;

  return json_build_object(
    'startsCountingFrom', to_char(v_start, 'YYYY-MM-DD'),
    'businessDaysNeeded', v_days,
    'promisedDeliveryDate', to_char(public.add_business_days(v_start, v_days - 1), 'YYYY-MM-DD')
  );
end;
$$;

-- ============ Criacao atomica de pedido ============

create or replace function public.create_order(
  p_plan_id uuid,
  p_knife_quantity integer,
  p_currency public.currency,
  p_affiliate_code text default null
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
  if p_knife_quantity < 1 or p_knife_quantity > 100 then
    raise exception 'INVALID_QUANTITY';
  end if;

  -- Lock serializador: pedidos simultaneos entram em fila de forma consistente.
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

  select coalesce(sum(total_images), 0) into v_backlog
  from public.orders
  where status in ('pending', 'in_progress');

  v_days := ceil((v_backlog + v_total_images)::numeric / v_settings.daily_capacity)::integer;
  v_promised := public.add_business_days(v_start, v_days - 1);

  if p_affiliate_code is not null and btrim(p_affiliate_code) <> '' then
    select * into v_affiliate from public.affiliates
    where code = upper(btrim(p_affiliate_code)) and active;
  end if;

  v_amount := v_price.amount_cents * p_knife_quantity;

  insert into public.orders (
    user_id, plan_id, knife_quantity, total_images, currency,
    unit_price_cents, subtotal_cents, total_cents,
    status, promised_delivery_date, affiliate_id
  ) values (
    auth.uid(), v_plan.id, p_knife_quantity, v_total_images, p_currency,
    v_price.amount_cents, v_amount, v_amount,
    'pending', v_promised, v_affiliate.id
  )
  returning * into v_order;

  return v_order;
end;
$$;

revoke execute on function public.create_order(uuid, integer, public.currency, text) from anon;
grant execute on function public.create_order(uuid, integer, public.currency, text) to authenticated;
revoke execute on function public.estimate_delivery(integer) from anon;
grant execute on function public.estimate_delivery(integer) to authenticated;

-- ============ Seed ============

insert into public.plans (angles, active)
values (1, true), (2, true), (3, true)
on conflict (angles) do nothing;

insert into public.app_settings (id)
values (1)
on conflict (id) do nothing;
