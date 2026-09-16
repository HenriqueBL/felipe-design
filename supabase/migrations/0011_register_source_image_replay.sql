-- Migration 0011: register_source_image idempotente por storage_path.
--
-- A UNIQUE (order_id, storage_path) ja existe (order_images_path_uq, 0008),
-- mas a RPC levantava erro 23505 generico no replay. Propriedade requerida:
--   same storage object -> exactly one order_images row
-- mesmo se o client chamar finalize/register duas vezes (inclusive concorrente).
--
-- Comportamento novo: se o mesmo storage_path ja foi registrado para o MESMO
-- pedido, a RPC retorna a row existente (idempotencia estavel), sem contar
-- como nova foto. Replay com knife_index diferente e rejeitado
-- (REPLAY_MISMATCH) para nao mascarar bug do client.

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

  -- Lock do pedido: serializa tentativas concorrentes (max por faca e replay).
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
  -- Retorna a row existente SEM exigir intake aberto (retry de finalize
  -- pos-submit nao deve falhar por freeze: o objeto ja pertence ao pedido).
  select * into v_image from public.order_images
  where order_id = p_order_id
    and storage_path = p_storage_path;
  if found then
    if v_image.kind <> 'source' or v_image.knife_index <> p_knife_index then
      raise exception 'REPLAY_MISMATCH';
    end if;
    return v_image;
  end if;

  -- Freeze: apos o submit, o intake esta fechado (apenas para NOVOS objetos).
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
