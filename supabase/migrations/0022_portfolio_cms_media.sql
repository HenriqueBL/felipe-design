-- Portfolio CMS: modelo Work + Media (até 3 ângulos por trabalho).
-- Migration ADITIVA. Campos legacy (image/before/after_storage_path) permanecem
-- para compatibilidade; backfill seguro cria media position=1 a partir deles.

-- 1. Tabela filha de mídias do portfolio.
create table if not exists public.portfolio_item_media (
  id uuid primary key default gen_random_uuid(),
  portfolio_item_id uuid not null references public.portfolio_items(id) on delete cascade,
  storage_path text not null,
  position smallint not null check (position between 1 and 3),
  width integer,
  height integer,
  aspect_ratio numeric(6,4),
  alt_text text,
  focal_point text not null default 'center' check (
    focal_point in (
      'top-left','top-center','top-right',
      'center-left','center','center-right',
      'bottom-left','bottom-center','bottom-right'
    )
  ),
  created_at timestamptz not null default now(),
  unique (portfolio_item_id, position)
);

-- Índice para consultas públicas ordenadas por posição dentro do work.
create index if not exists portfolio_item_media_item_position_idx
  on public.portfolio_item_media (portfolio_item_id, position);

-- 2. Campos no parent para Hero/Cover e focal point global do work.
alter table public.portfolio_items
  add column if not exists hero_media_id uuid references public.portfolio_item_media(id) on delete set null;

alter table public.portfolio_items
  add column if not exists focal_point text not null default 'center' check (
    focal_point in (
      'top-left','top-center','top-right',
      'center-left','center','center-right',
      'bottom-left','bottom-center','bottom-right'
    )
  );

-- 3. RLS: mídias seguem a mesma política do parent.
alter table public.portfolio_item_media enable row level security;

create policy portfolio_media_select_public on public.portfolio_item_media
  for select using (
    exists (
      select 1 from public.portfolio_items pi
      where pi.id = portfolio_item_media.portfolio_item_id
        and (pi.published or public.is_admin())
    )
  );

create policy portfolio_media_admin on public.portfolio_item_media
  for all using (public.is_admin()) with check (public.is_admin());

-- 4. RPC: próximo sort_order seguro contra concorrência.
create or replace function public.next_portfolio_sort_order()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  next_val integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  -- Lock leve para serializar inserts concorrentes sem bloquear reads.
  lock table public.portfolio_items in share update exclusive mode;

  select coalesce(max(sort_order), 0) + 1 into next_val
    from public.portfolio_items;

  return next_val;
end;
$$;

revoke all on function public.next_portfolio_sort_order() from public, anon;
grant execute on function public.next_portfolio_sort_order() to authenticated;

-- 5. RPC: reorder transacional de works (normaliza 1..N).
create or replace function public.reorder_portfolio_works(work_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  wid uuid;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  if work_ids is null or array_length(work_ids, 1) is null then
    raise exception 'work_ids must be a non-empty array';
  end if;

  -- Verificar duplicatas.
  if array_length(work_ids, 1) <> array_length(array(select distinct unnest(work_ids)), 1) then
    raise exception 'duplicate work ids in reorder list';
  end if;

  -- Verificar se todos existem.
  for wid in select unnest(work_ids) loop
    if not exists (select 1 from public.portfolio_items where id = wid) then
      raise exception 'portfolio item not found: %', wid;
    end if;
  end loop;

  -- Normalizar sort_order para 1..N na ordem fornecida.
  for i in 1..array_length(work_ids, 1) loop
    update public.portfolio_items
       set sort_order = i
     where id = work_ids[i];
  end loop;
end;
$$;

revoke all on function public.reorder_portfolio_works(uuid[]) from public, anon;
grant execute on function public.reorder_portfolio_works(uuid[]) to authenticated;

-- 6. RPC: reorder transacional de media dentro de um work (normaliza 1..N).
create or replace function public.reorder_portfolio_media(
  p_portfolio_item_id uuid,
  p_media_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
  mid uuid;
  cnt integer;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only';
  end if;

  if p_media_ids is null or array_length(p_media_ids, 1) is null then
    raise exception 'p_media_ids must be a non-empty array';
  end if;

  if array_length(p_media_ids, 1) > 3 then
    raise exception 'max 3 media per work';
  end if;

  -- Verificar duplicatas.
  if array_length(p_media_ids, 1) <> array_length(array(select distinct unnest(p_media_ids)), 1) then
    raise exception 'duplicate media ids in reorder list';
  end if;

  -- Verificar se todas as medias pertencem ao work.
  select count(*) into cnt
    from public.portfolio_item_media
   where portfolio_item_id = p_portfolio_item_id
     and id = any(p_media_ids);

  if cnt <> array_length(p_media_ids, 1) then
    raise exception 'media ids do not all belong to the specified work';
  end if;

  -- Two-phase reorder: assign temporary negative positions first to avoid
  -- unique constraint violations during the swap, then normalize to 1..N.
  for i in 1..array_length(p_media_ids, 1) loop
    update public.portfolio_item_media
       set position = (-i)::smallint
     where id = p_media_ids[i]
       and portfolio_item_id = p_portfolio_item_id;
  end loop;

  for i in 1..array_length(p_media_ids, 1) loop
    update public.portfolio_item_media
       set position = i::smallint
     where id = p_media_ids[i]
       and portfolio_item_id = p_portfolio_item_id;
  end loop;
end;
$$;

revoke all on function public.reorder_portfolio_media(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_portfolio_media(uuid, uuid[]) to authenticated;

-- 7. Backfill seguro: criar media position=1 a partir dos campos legacy.
-- Idempotente: só insere se não existir media para aquele work ainda.
-- Prioridade: image_storage_path > after_storage_path > before_storage_path.
do $$
declare
  item record;
  resolved_path text;
begin
  for item in
    select id, image_storage_path, after_storage_path, before_storage_path
      from public.portfolio_items
  loop
    -- Pular se já tem media neste work (idempotência).
    if exists (
      select 1 from public.portfolio_item_media
       where portfolio_item_id = item.id
    ) then
      continue;
    end if;

    resolved_path := coalesce(
      item.image_storage_path,
      item.after_storage_path,
      item.before_storage_path
    );

    if resolved_path is not null then
      insert into public.portfolio_item_media (
        portfolio_item_id, storage_path, position, focal_point
      ) values (
        item.id, resolved_path, 1, 'center'
      );
    end if;
  end loop;
end;
$$;