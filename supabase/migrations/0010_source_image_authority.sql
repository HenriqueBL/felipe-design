-- Migration 0010: register_source_image como unica autoridade de source image.
--
-- Bug corrigido: a policy order_images_insert_own (0008) ainda permitia
-- INSERT direto de kind='source' pelo cliente, contornando o lock transacional,
-- o max_source_photos_per_knife e a validacao de knife_index da RPC
-- register_source_image. A partir de agora:
--
--   * Cliente NAO pode inserir kind='source' direto na tabela.
--     O unico caminho e a RPC transacional register_source_image
--     (que roda como SECURITY DEFINER e aplica todas as regras).
--   * Cliente pode deletar source photos APENAS enquanto o intake esta
--     aberto, via RPC transacional delete_source_image (retorna o
--     storage_path para o cliente remover o objeto do Storage).
--   * Delete direto pela tabela continua admin-only.
--   * Result images (kind='result', enviadas pelo admin/Felipe) nao sao
--     afetadas: o admin tem a policy order_images_admin (for all).
--
-- NOTA TECNICA (pre-producao): revisar a 0009 antes de provisionar PROD —
-- ela contem tratamento de fixture legado especifico do DEV (pedido
-- 723a31ab-... excludo por decisao do dono). Nao replicar esse padrao.

-- ============ INSERT: cliente perde o caminho direto de source ============

drop policy if exists order_images_insert_own on public.order_images;

-- Cliente so insere kinds <> 'source' (nenhum fluxo atual do cliente insere
-- result images; a policy existe apenas para nao bloquear eventuais usos
-- nao-source do dono, e exige intake aberto por consistencia).
create policy order_images_insert_own on public.order_images
  for insert with check (
    kind <> 'source'
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.source_photos_submitted_at is null
    )
  );

-- register_source_image (SECURITY DEFINER, 0008) nao e afetada por RLS e
-- continua sendo a unica via de registro de source images pelo cliente.

-- ============ DELETE transacional de source image ============

-- O cliente remove a source photo somente com intake aberto. A funcao
-- trava o pedido (FOR UPDATE), valida ownership e kind, remove a row e
-- devolve o storage_path para o chamador limpar o objeto no Storage.
-- O trigger order_images_sync_count (0005) mantem source_image_count.
-- Idempotencia de erro: erros sao explicitos (FORBIDDEN/INTAKE_CLOSED/...).

create or replace function public.delete_source_image(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_image public.order_images;
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_image from public.order_images
  where id = p_image_id;
  if not found then
    raise exception 'IMAGE_NOT_FOUND';
  end if;

  if v_image.kind <> 'source' then
    raise exception 'NOT_A_SOURCE_IMAGE';
  end if;

  -- Lock do pedido: serializa com register_source_image/submit.
  select * into v_order from public.orders
  where id = v_image.order_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.user_id <> auth.uid() and not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if v_order.source_photos_submitted_at is not null then
    raise exception 'INTAKE_CLOSED';
  end if;

  delete from public.order_images
  where id = p_image_id;

  -- Caller usa este path para remover o objeto do bucket client-uploads.
  return v_image.storage_path;
end;
$$;

revoke execute on function public.delete_source_image(uuid) from public, anon;
grant execute on function public.delete_source_image(uuid) to authenticated, service_role;