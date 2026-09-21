-- Migration 0018: fix create_cart_order price snapshot consistency and plan_id semantics.
--
-- Bug: the original RPC read plan_prices twice (once for validation/totals,
-- once for item inserts). A concurrent set_plan_price between the two reads
-- could produce orders.total_cents based on price A and order_items.subtotal
-- based on price B, violating the snapshot guarantee.
--
-- Fix: validate and snapshot prices into a TEMP TABLE in the first pass,
-- then insert order + items exclusively from that temp table. No second
-- read of plan_prices or plans occurs after the order row is created.
--
-- Semantics change: orders.plan_id is now NULL for multi-item orders
-- (>1 item). For single-item orders it retains the plan_id. This makes
-- order_items the sole authority for composition; no reader should treat
-- orders.plan_id as "the plan of the entire order" when items > 1.

create or replace function public.create_cart_order(
  p_items jsonb,
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
  v_settings       public.app_settings;
  v_today          date;
  v_affiliate      public.affiliates;
  v_order          public.orders;
  v_count          integer;
  v_line           jsonb;
  v_plan_id        uuid;
  v_qty            integer;
  v_plan           public.plans;
  v_price          public.plan_prices;
  v_total_knives   integer := 0;
  v_total_images   integer := 0;
  v_total_cents    integer := 0;
  v_item_index     integer := 0;
  v_knife_start    integer := 1;
  v_row            record;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Idempotency: same key returns the existing order (double-click, retry).
  if p_idempotency_key is not null then
    select * into v_order from public.orders
    where idempotency_key = p_idempotency_key and user_id = auth.uid();
    if v_order.id is not null then
      return v_order;
    end if;
  end if;

  -- Validate intent shape: 1..20 lines, qty 1..100, plan uuid.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ITEMS';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 or v_count > 20 then
    raise exception 'INVALID_ITEMS';
  end if;

  select * into v_settings from public.app_settings where id = 1;
  v_today := (now() at time zone v_settings.timezone)::date;

  if p_affiliate_code is not null and btrim(p_affiliate_code) <> '' then
    select * into v_affiliate from public.affiliates
    where code = upper(btrim(p_affiliate_code)) and active;
  end if;

  -- ── PASS 1: validate + snapshot into temp table ──────────────────────
  -- Single read of plans and plan_prices per line. All computed values
  -- are stored here; the second pass reads ONLY from this temp table.
  create temp table _cart_validated_items (
    item_index      integer primary key,
    plan_id         uuid    not null,
    quantity        integer not null,
    angles          smallint not null,
    unit_price_cents integer not null,
    subtotal_cents  integer not null,
    total_images    integer not null,
    knife_index_start integer not null
  ) on commit drop;

  v_knife_start := 1;
  for v_line in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'INVALID_ITEMS';
    end if;

    begin
      v_plan_id := (v_line ->> 'plan_id')::uuid;
      v_qty     := (v_line ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_ITEMS';
    end;

    if v_plan_id is null or v_qty is null or v_qty < 1 or v_qty > 100 then
      raise exception 'INVALID_ITEMS';
    end if;

    select * into v_plan from public.plans where id = v_plan_id and active;
    if not found then
      raise exception 'PLAN_NOT_FOUND';
    end if;

    select * into v_price from public.plan_prices
    where plan_id = v_plan_id
      and currency = p_currency
      and active
      and valid_from <= v_today
      and (valid_until is null or valid_until >= v_today)
    order by valid_from desc
    limit 1;
    if not found then
      raise exception 'PRICE_NOT_FOUND';
    end if;

    v_item_index := v_item_index + 1;

    insert into _cart_validated_items (
      item_index, plan_id, quantity, angles,
      unit_price_cents, subtotal_cents, total_images, knife_index_start
    ) values (
      v_item_index, v_plan_id, v_qty, v_plan.angles,
      v_price.amount_cents,
      v_price.amount_cents * v_qty,
      v_qty * v_plan.angles,
      v_knife_start
    );

    v_total_knives := v_total_knives + v_qty;
    v_total_images := v_total_images + (v_qty * v_plan.angles);
    v_total_cents  := v_total_cents  + (v_price.amount_cents * v_qty);
    v_knife_start  := v_knife_start  + v_qty;
  end loop;

  -- ── INSERT ORDER + ITEMS from snapshot ───────────────────────────────
  -- orders.plan_id: set only for single-item orders; NULL otherwise.
  begin
    insert into public.orders (
      user_id, plan_id, knife_quantity, total_images, currency,
      unit_price_cents, subtotal_cents, total_cents,
      status, promised_delivery_date, affiliate_id, idempotency_key,
      required_source_photos_per_knife, max_source_photos_per_knife,
      max_source_photo_size_mb
    ) values (
      auth.uid(),
      case when v_item_index = 1 then (select plan_id from _cart_validated_items where item_index = 1) else null end,
      v_total_knives, v_total_images, p_currency,
      (select unit_price_cents from _cart_validated_items where item_index = 1),
      v_total_cents, v_total_cents,
      'pending', null, v_affiliate.id, p_idempotency_key,
      v_settings.min_source_photos_per_knife,
      v_settings.max_source_photos_per_knife,
      v_settings.max_source_photo_size_mb
    )
    returning * into v_order;

    -- Insert items exclusively from the snapshot — no re-read of plans/prices.
    insert into public.order_items (
      order_id, item_index, plan_id, knife_quantity, angles,
      unit_price_cents, subtotal_cents, total_images, knife_index_start
    )
    select
      v_order.id, item_index, plan_id, quantity, angles,
      unit_price_cents, subtotal_cents, total_images, knife_index_start
    from _cart_validated_items
    order by item_index;

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

revoke execute on function public.create_cart_order(jsonb, public.currency, text, uuid)
  from public, anon;
grant execute on function public.create_cart_order(jsonb, public.currency, text, uuid)
  to authenticated, service_role;