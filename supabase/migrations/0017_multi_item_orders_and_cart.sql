-- Migration 0017: multi-item orders and shopping cart.
--
-- One order can now contain multiple plan/angle configurations. The new
-- table order_items stores one row per (plan, knife_quantity) line with
-- immutable snapshots (angles, unit_price_cents, subtotal, total_images).
--
-- Knife identity: each item owns a contiguous global range of knife
-- indexes [knife_index_start, knife_index_start + knife_quantity - 1].
-- order_images.knife_index remains a single unambiguous global index;
-- the owning item is derived from the range. Backfill: every legacy
-- order becomes exactly one item (item_index 1, knife_index_start 1).
--
-- Legacy compatibility: orders keeps its aggregate snapshot columns
-- (total_cents, total_images, knife_quantity, ...); payments, queue and
-- source photo intake keep reading those aggregates. The single-item
-- create_order RPC is untouched; create_cart_order is additive.
-- orders.plan_id becomes nullable (multi-item orders have no single plan);
-- legacy rows keep their value.

-- ============ order_items ============

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_index integer not null check (item_index >= 1),
  plan_id uuid not null references public.plans (id),
  knife_quantity integer not null check (knife_quantity between 1 and 100),
  angles smallint not null check (angles between 1 and 3),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  subtotal_cents integer not null check (subtotal_cents >= 0),
  total_images integer not null check (total_images > 0),
  knife_index_start integer not null check (knife_index_start >= 1),
  created_at timestamptz not null default now(),
  constraint order_items_index_uq unique (order_id, item_index),
  constraint order_items_start_uq unique (order_id, knife_index_start),
  constraint order_items_subtotal_matches
    check (subtotal_cents = unit_price_cents * knife_quantity),
  constraint order_items_images_matches
    check (total_images = knife_quantity * angles)
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- The one-price-per-order checks no longer hold for multi-item orders.
-- Equality is now enforced transactionally in create_cart_order (and by
-- the per-item checks above, which are strictly stronger per line).
alter table public.orders drop constraint if exists orders_subtotal_matches;
alter table public.orders drop constraint if exists orders_total_matches;

-- Multi-item orders have no single plan; FK kept for legacy/1-item orders.
alter table public.orders alter column plan_id drop not null;

-- ============ Backfill: one item per legacy order ============

-- Idempotent: only orders without any items are backfilled. Snapshot
-- values come from the order row itself (plan angles joined at backfill
-- time — immutable per plan definition, 1..3 unique).
insert into public.order_items (
  order_id, item_index, plan_id, knife_quantity, angles,
  unit_price_cents, subtotal_cents, total_images, knife_index_start
)
select
  o.id, 1, o.plan_id, o.knife_quantity, p.angles,
  o.unit_price_cents, o.subtotal_cents, o.total_images, 1
from public.orders o
join public.plans p on p.id = o.plan_id
where not exists (
  select 1 from public.order_items oi where oi.order_id = o.id
);

-- ============ create_cart_order ============

-- Authority: the browser sends only intent — a list of
-- {plan_id, quantity} lines, currency and idempotency key. The RPC
-- validates plans, snapshots current prices, computes all totals and
-- total_images, and writes order + items in one transaction.
-- Error codes: NOT_AUTHENTICATED, INVALID_ITEMS, PLAN_NOT_FOUND,
-- PRICE_NOT_FOUND, IDEMPOTENCY_CONFLICT.

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
  v_settings public.app_settings;
  v_today date;
  v_affiliate public.affiliates;
  v_order public.orders;
  v_count integer;
  v_line jsonb;
  v_plan_id uuid;
  v_qty integer;
  v_plan public.plans;
  v_price public.plan_prices;
  v_total_knives integer := 0;
  v_total_images integer := 0;
  v_total_cents integer := 0;
  v_first_unit_price integer;
  v_single_plan_id uuid;
  v_item_index integer := 0;
  v_knife_start integer := 1;
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

  -- Validate the intent shape first: 1..20 lines, qty 1..100, plan uuid.
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

  -- Validate every line and snapshot prices BEFORE writing anything.
  for v_line in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'INVALID_ITEMS';
    end if;
    v_plan_id := null;
    v_qty := null;
    begin
      v_plan_id := (v_line ->> 'plan_id')::uuid;
      v_qty := (v_line ->> 'quantity')::integer;
    exception when others then
      raise exception 'INVALID_ITEMS';
    end;
    if v_plan_id is null or v_qty is null or v_qty < 1 or v_qty > 100 then
      raise exception 'INVALID_ITEMS';
    end if;

    select * into v_plan from public.plans
    where id = v_plan_id and active;
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

    v_total_knives := v_total_knives + v_qty;
    v_total_images := v_total_images + (v_qty * v_plan.angles);
    v_total_cents := v_total_cents + (v_price.amount_cents * v_qty);

    if v_item_index = 0 then
      v_first_unit_price := v_price.amount_cents;
      v_single_plan_id := v_plan_id;
    end if;
    v_item_index := v_item_index + 1;
  end loop;

  -- Create the order, then the items, inside one transaction; a failure
  -- in any item insert rolls the whole order back (no partial orders).
  begin
    insert into public.orders (
      user_id, plan_id, knife_quantity, total_images, currency,
      unit_price_cents, subtotal_cents, total_cents,
      status, promised_delivery_date, affiliate_id, idempotency_key,
      required_source_photos_per_knife, max_source_photos_per_knife,
      max_source_photo_size_mb
    ) values (
      auth.uid(), v_single_plan_id, v_total_knives, v_total_images,
      p_currency,
      v_first_unit_price, v_total_cents, v_total_cents,
      'pending', null, v_affiliate.id, p_idempotency_key,
      v_settings.min_source_photos_per_knife,
      v_settings.max_source_photos_per_knife,
      v_settings.max_source_photo_size_mb
    )
    returning * into v_order;

    v_item_index := 0;
    v_knife_start := 1;
    for v_line in select * from jsonb_array_elements(p_items) loop
      v_plan_id := (v_line ->> 'plan_id')::uuid;
      v_qty := (v_line ->> 'quantity')::integer;

      select * into v_plan from public.plans where id = v_plan_id;
      select * into v_price from public.plan_prices
      where plan_id = v_plan_id
        and currency = p_currency
        and active
        and valid_from <= v_today
        and (valid_until is null or valid_until >= v_today)
      order by valid_from desc
      limit 1;

      v_item_index := v_item_index + 1;
      insert into public.order_items (
        order_id, item_index, plan_id, knife_quantity, angles,
        unit_price_cents, subtotal_cents, total_images, knife_index_start
      ) values (
        v_order.id, v_item_index, v_plan_id, v_qty, v_plan.angles,
        v_price.amount_cents, v_price.amount_cents * v_qty,
        v_qty * v_plan.angles, v_knife_start
      );

      v_knife_start := v_knife_start + v_qty;
    end loop;
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

-- ============ Intake: knife ranges validated per item ============

-- Knife validity now derives from order_items ranges (which cover
-- 1..knife_quantity exactly). Orders without items cannot exist after
-- the backfill, but the legacy check is kept as a defensive fallback.

create or replace function public.register_source_image(
  p_order_id uuid,
  p_knife_index integer,
  p_storage_path text,
  p_original_filename text
)
returns public.order_images
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_count integer;
  v_image public.order_images;
  v_item_found boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_order from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Replay idempotente: mesmo objeto ja registrado para este pedido.
  select * into v_image from public.order_images
  where order_id = p_order_id
    and storage_path = p_storage_path;
  if found then
    if v_image.kind <> 'source' or v_image.knife_index <> p_knife_index then
      raise exception 'REPLAY_MISMATCH';
    end if;
    return v_image;
  end if;

  if v_order.source_photos_submitted_at is not null then
    raise exception 'INTAKE_CLOSED';
  end if;

  -- Knife index must fall inside an item's range (post-0017 orders).
  select exists (
    select 1 from public.order_items oi
    where oi.order_id = p_order_id
      and p_knife_index >= oi.knife_index_start
      and p_knife_index < oi.knife_index_start + oi.knife_quantity
  ) into v_item_found;

  if p_knife_index is null or p_knife_index < 1
     or (v_item_found is false and p_knife_index > v_order.knife_quantity) then
    raise exception 'INVALID_KNIFE_INDEX';
  end if;

  select count(*) into v_count
  from public.order_images
  where order_id = p_order_id
    and kind = 'source'
    and knife_index = p_knife_index;

  if v_count >= v_order.max_source_photos_per_knife then
    raise exception 'MAX_PHOTOS_PER_KNIFE_EXCEEDED';
  end if;

  insert into public.order_images (
    order_id, kind, knife_index, storage_path, original_filename
  ) values (
    p_order_id, 'source', p_knife_index, p_storage_path, p_original_filename
  )
  returning * into v_image;

  return v_image;
end;
$$;

revoke execute on function public.register_source_image(uuid, integer, text, text) from public, anon;
grant execute on function public.register_source_image(uuid, integer, text, text) to authenticated, service_role;

-- submit_source_photos / maybe_mark_order_ready: the per-knife min check
-- iterates the union of item ranges, which equals 1..knife_quantity, so the
-- existing 1..knife_quantity loops remain CORRECT for multi-item orders
-- (aggregates on orders cover all items). No change needed — documented
-- here so the invariant is explicit: orders.knife_quantity = total knives
-- across items; orders.total_images = sum of item total_images.

-- ============ RLS on order_items ============

alter table public.order_items enable row level security;

-- Clients never write order_items directly; only SECURITY DEFINER RPCs.

create policy order_items_select_own_or_admin on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())
    )
  );

revoke all on public.order_items from public, anon;
grant select on public.order_items to authenticated, service_role;