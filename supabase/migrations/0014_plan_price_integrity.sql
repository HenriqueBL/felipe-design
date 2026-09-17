-- 0014: plan price integrity
-- Serialize set_plan_price per plan via advisory row lock on plans,
-- derive v_today from app_settings.timezone (consistent with create_order),
-- and enforce at most one open (active, valid_until is null) price per
-- plan+currency via a partial unique index.
-- 0001-0013 are immutable; this migration only replaces set_plan_price
-- and adds the partial unique index.

-- Precondition: fail loudly and do nothing if the invariant is already
-- violated, so operators must resolve data explicitly instead of the
-- migration silently picking a winner.
do $$
begin
  if exists (
    select 1
    from public.plan_prices
    where active and valid_until is null
    group by plan_id, currency
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_OPEN_PLAN_PRICES: plan_prices has more than one active row with valid_until IS NULL for some (plan_id, currency). Resolve duplicates before applying 0014.';
  end if;
end
$$;

create unique index if not exists plan_prices_open_uq
  on public.plan_prices (plan_id, currency)
  where active and valid_until is null;

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
  v_today date;
  v_current public.plan_prices;
  v_new public.plan_prices;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_amount_cents < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Deterministic serialization per plan: lock the plan row before reading
  -- or writing prices. Concurrent set_plan_price calls for the same plan
  -- are ordered here; different plans proceed in parallel.
  perform 1 from public.plans where id = p_plan_id for update;

  select (now() at time zone s.timezone)::date into v_today
  from public.app_settings s
  where s.id = 1;

  if v_today is null then
    raise exception 'SETTINGS_MISSING';
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