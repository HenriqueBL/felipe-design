-- Migration 0008: source photo intake (INPUT) separado de total_images (OUTPUT)
--
-- Bug corrigido: source_image_count >= total_images era usado como condicao
-- de production-ready. total_images representa ENTREGAVEIS (OUTPUT); source
-- photos representam MATERIAL (INPUT). Regra nova por faca:
--
--   paid_at IS NOT NULL
--   AND source_photos_submitted_at IS NOT NULL
--   AND cada faca possui >= required_source_photos_per_knife source photos
--
-- Politica de upload e snapshotada NO MOMENTO DE CREATE ORDER (pedido pode
-- existir antes do pagamento). Mudancas no admin afetam apenas pedidos novos.
-- Pedidos existentes recebem snapshot legado 3/5/25 via DEFAULT.

-- ============ Defaults globais (app_settings) ============

alter table public.app_settings
  add column if not exists min_source_photos_per_knife integer not null default 3
    check (min_source_photos_per_knife between 1 and 50);

alter table public.app_settings
  add column if not exists max_source_photos_per_knife integer not null default 5
    check (max_source_photos_per_knife between 1 and 50
           and max_source_photos_per_knife >= min_source_photos_per_knife);

alter table public.app_settings
  add column if not exists max_source_photo_size_mb integer not null default 25
    check (max_source_photo_size_mb between 1 and 100);

-- ============ Snapshots por pedido (orders) ============

-- Snapshot imutavel apos a criacao do pedido. O DEFAULT serve de backfill
-- deterministico para pedidos existentes (snapshot legado 3/5/25).
alter table public.orders
  add column if not exists required_source_photos_per_knife integer not null default 3
    check (required_source_photos_per_knife between 1 and 50);

alter table public.orders
  add column if not exists max_source_photos_per_knife integer not null default 5
    check (max_source_photos_per_knife between 1 and 50
           and max_source_photos_per_knife >= required_source_photos_per_knife);

alter table public.orders
  add column if not exists max_source_photo_size_mb integer not null default 25
    check (max_source_photo_size_mb between 1 and 100);

-- Intake aberto enquanto NULL; apos o submit explicito do cliente,
-- o intake fica congelado (freeze).
alter table public.orders
  add column if not exists source_photos_submitted_at timestamptz;

-- ============ order_images: associacao por faca ============

alter table public.order_images
  add column if not exists knife_index integer
    check (knife_index is null or knife_index >= 1);

-- Source images exigem knife_index; result images continuam sem redesign.
alter table public.order_images
  add constraint order_images_source_requires_knife
  check (kind <> 'source' or knife_index is not null) not valid;

-- A validade knife_index <= knife_quantity do pedido e garantida pela
-- funcao transacional register_source_image (FK cross-row nao existe).

-- ============ create_order: snapshot da politica de upload ============

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
      status, promised_delivery_date, affiliate_id, idempotency_key,
      required_source_photos_per_knife, max_source_photos_per_knife,
      max_source_photo_size_mb
    ) values (
      auth.uid(), v_plan.id, p_knife_quantity, v_total_images, p_currency,
      v_price.amount_cents, v_amount, v_amount,
      'pending', null, v_affiliate.id, p_idempotency_key,
      v_settings.min_source_photos_per_knife,
      v_settings.max_source_photos_per_knife,
      v_settings.max_source_photo_size_mb
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

-- ============ Registro transacional de source photo ============

-- Autoridade do maximo por faca: NAO confia apenas em RLS+count (race
-- condition). O lock FOR UPDATE no pedido serializa registros concorrentes
-- do mesmo pedido; o limite e checado dentro da mesma transacao.

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
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock do pedido: serializa tentativas concorrentes (max por faca).
  select * into v_order from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  -- Freeze: apos o submit, o intake esta fechado.
  if v_order.source_photos_submitted_at is not null then
    raise exception 'INTAKE_CLOSED';
  end if;

  if p_knife_index is null or p_knife_index < 1
     or p_knife_index > v_order.knife_quantity then
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

-- ============ Finalizacao explicita do intake ============

create or replace function public.submit_source_photos(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_k integer;
  v_count integer;
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

  -- Idempotente: submit repetido devolve o pedido sem efeito adicional.
  if v_order.source_photos_submitted_at is not null then
    return v_order;
  end if;

  -- Cada faca precisa do minimo; nenhuma pode exceder o maximo
  -- (defense-in-depth: register_source_image ja garante o maximo).
  for v_k in 1..v_order.knife_quantity loop
    select count(*) into v_count
    from public.order_images
    where order_id = p_order_id
      and kind = 'source'
      and knife_index = v_k;

    if v_count < v_order.required_source_photos_per_knife then
      raise exception 'MIN_PHOTOS_NOT_MET for knife %', v_k;
    end if;
    if v_count > v_order.max_source_photos_per_knife then
      raise exception 'MAX_PHOTOS_EXCEEDED for knife %', v_k;
    end if;
  end loop;

  update public.orders
    set source_photos_submitted_at = now(),
        updated_at = now()
    where id = p_order_id
    returning * into v_order;

  -- Pode ativar a fila imediatamente caso o pagamento ja tenha ocorrido.
  perform public.maybe_mark_order_ready(p_order_id);

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

revoke execute on function public.submit_source_photos(uuid) from public, anon;
grant execute on function public.submit_source_photos(uuid) to authenticated, service_role;

-- ============ Regra final de production-ready ============

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
  v_k integer;
  v_count integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  if v_order.production_ready_at is not null then
    return;
  end if;
  if v_order.paid_at is null then
    return;
  end if;
  if v_order.source_photos_submitted_at is null then
    return;
  end if;

  -- Defense-in-depth: cada faca com o minimo (submit_source_photos valida).
  for v_k in 1..v_order.knife_quantity loop
    select count(*) into v_count
    from public.order_images
    where order_id = p_order_id
      and kind = 'source'
      and knife_index = v_k;
    if v_count < v_order.required_source_photos_per_knife then
      return;
    end if;
  end loop;

  -- Lock serializador: dois pedidos ficando ready simultaneamente
  -- recebem backlog consistente (mesma estrategia anterior).
  select * into v_settings from public.app_settings where id = 1 for update;

  v_today := (now() at time zone v_settings.timezone)::date;

  if ((now() at time zone v_settings.timezone)::time >= v_settings.cutoff_time::time)
     or not public.is_business_day(v_today) then
    v_start := public.next_business_day(v_today);
  else
    v_start := v_today;
  end if;

  v_backlog := public.current_backlog_images();

  -- total_images (OUTPUT/deliveraveis) continua sendo a unidade de workload.
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

-- ============ Freeze pos-submit na RLS de insert ============

-- Barreira adicional (a autoridade do maximo/congelamento e a RPC
-- transacional): inserts diretos do cliente exigem intake aberto.
drop policy if exists order_images_insert_own on public.order_images;

create policy order_images_insert_own on public.order_images
  for insert with check (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.source_photos_submitted_at is null
    )
    and (kind <> 'source' or knife_index is not null)
  );

-- ============ update_app_settings: novos campos ============

-- Assinatura muda: drop + create (revoke/grant no padrao de 0003/0004).

drop function if exists public.update_app_settings(integer, text, text);

create function public.update_app_settings(
  p_daily_capacity integer,
  p_cutoff_time text,
  p_timezone text,
  p_min_source_photos_per_knife integer default null,
  p_max_source_photos_per_knife integer default null,
  p_max_source_photo_size_mb integer default null
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
  if p_timezone not in (select name from pg_timezone_names) then
    raise exception 'INVALID_TIMEZONE';
  end if;
  if p_min_source_photos_per_knife is not null
     and (p_min_source_photos_per_knife < 1 or p_min_source_photos_per_knife > 50) then
    raise exception 'INVALID_MIN_SOURCE_PHOTOS';
  end if;
  if p_max_source_photos_per_knife is not null
     and (p_max_source_photos_per_knife < 1 or p_max_source_photos_per_knife > 50) then
    raise exception 'INVALID_MAX_SOURCE_PHOTOS';
  end if;
  if p_min_source_photos_per_knife is not null and p_max_source_photos_per_knife is not null
     and p_max_source_photos_per_knife < p_min_source_photos_per_knife then
    raise exception 'MAX_LESS_THAN_MIN';
  end if;
  if p_max_source_photo_size_mb is not null
     and (p_max_source_photo_size_mb < 1 or p_max_source_photo_size_mb > 100) then
    raise exception 'INVALID_MAX_SOURCE_PHOTO_SIZE';
  end if;

  update public.app_settings
    set daily_capacity = p_daily_capacity,
        cutoff_time = p_cutoff_time,
        timezone = p_timezone,
        min_source_photos_per_knife = coalesce(p_min_source_photos_per_knife, min_source_photos_per_knife),
        max_source_photos_per_knife = coalesce(p_max_source_photos_per_knife, max_source_photos_per_knife),
        max_source_photo_size_mb = coalesce(p_max_source_photo_size_mb, max_source_photo_size_mb),
        updated_at = now()
    where id = 1
    returning * into v_settings;

  return v_settings;
end;
$$;

revoke execute on function public.update_app_settings(integer, text, text, integer, integer, integer) from public, anon;
grant execute on function public.update_app_settings(integer, text, text, integer, integer, integer) to authenticated, service_role;