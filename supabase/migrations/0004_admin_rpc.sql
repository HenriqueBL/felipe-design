-- Migration 0004: RPCs administrativas (preco com historico, plano, settings, status)
-- Execucao restrita a admins (RLS nao se aplica a security definer; guardamos com is_admin()).

-- ============ Preco do plano ============
-- Cria nova vigencia de preco em vez de alterar linhas antigas.
-- Pedidos antigos preservam o snapshot (unit_price_cents gravado na venda).

create or replace function public.set_plan_price(
  p_plan_id uuid,
  p_currency public.currency,
  p_amount_cents integer
)
returns public.plan_prices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_current public.plan_prices;
  v_new public.plan_prices;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_current
  from public.plan_prices
  where plan_id = p_plan_id
    and currency = p_currency
    and active
    and valid_until is null
  order by valid_from desc
  limit 1;

  if v_current.id is null then
    insert into public.plan_prices (plan_id, currency, amount_cents, valid_from, active)
    values (p_plan_id, p_currency, p_amount_cents, v_today, true)
    returning * into v_new;
  elsif v_current.valid_from = v_today then
    update public.plan_prices
      set amount_cents = p_amount_cents
      where id = v_current.id
      returning * into v_new;
  else
    update public.plan_prices
      set valid_until = v_today - 1, active = false
      where id = v_current.id;

    insert into public.plan_prices (plan_id, currency, amount_cents, valid_from, active)
    values (p_plan_id, p_currency, p_amount_cents, v_today, true)
    returning * into v_new;
  end if;

  return v_new;
end;
$$;

-- ============ Ativar/desativar plano ============

create or replace function public.set_plan_active(
  p_plan_id uuid,
  p_active boolean
)
returns public.plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plans;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.plans
    set active = p_active
    where id = p_plan_id
    returning * into v_plan;

  if v_plan.id is null then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  return v_plan;
end;
$$;

-- ============ Configuracoes operacionais ============

create or replace function public.update_app_settings(
  p_daily_capacity integer,
  p_cutoff_time text,
  p_timezone text
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.app_settings;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_daily_capacity < 1 or p_daily_capacity > 1000 then
    raise exception 'INVALID_CAPACITY';
  end if;
  if p_cutoff_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'INVALID_CUTOFF_TIME';
  end if;
  if p_timezone not in (
    select name from pg_timezone_names
  ) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  update public.app_settings
    set daily_capacity = p_daily_capacity,
        cutoff_time = p_cutoff_time,
        timezone = p_timezone,
        updated_at = now()
    where id = 1
    returning * into v_settings;

  return v_settings;
end;
$$;

-- ============ Status do pedido ============
-- promised_delivery_date nunca e reduzido automaticamente.

create or replace function public.set_order_status(
  p_order_id uuid,
  p_status public.order_status
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.orders
    set status = p_status
    where id = p_order_id
    returning * into v_order;

  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  return v_order;
end;
$$;

revoke execute on function public.set_plan_price(uuid, public.currency, integer) from anon, authenticated;
revoke execute on function public.set_plan_active(uuid, boolean) from anon, authenticated;
revoke execute on function public.update_app_settings(integer, text, text) from anon, authenticated;
revoke execute on function public.set_order_status(uuid, public.order_status) from anon, authenticated;

grant execute on function public.set_plan_price(uuid, public.currency, integer) to authenticated;
grant execute on function public.set_plan_active(uuid, boolean) to authenticated;
grant execute on function public.update_app_settings(integer, text, text) to authenticated;
grant execute on function public.set_order_status(uuid, public.order_status) to authenticated;
