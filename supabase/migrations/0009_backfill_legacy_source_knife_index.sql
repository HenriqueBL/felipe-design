-- Migration 0009: backfill deterministico de knife_index para rows legadas.
--
-- A migration 0008 adicionou knife_index a order_images com constraint
-- NOT VALID (kind='source' exige knife_index). Rows legadas de source
-- photos criadas antes da 0008 ficaram com knife_index NULL.
--
-- Decisao registrada (aprovada pelo dono do produto em 2026-09-16):
-- 1. O pedido 723a31ab-7de7-4f11-8983-2903fd7360cb (2 facas, 2 fotos,
--    dono test-upload-*@example.com) e fixture residual de suíte de teste,
--    nao cliente real. E excluido deterministicamente por ID antes do
--    backfill (pedido + order_images dependentes).
-- 2. Pedido legacy com knife_quantity = 1 => knife_index = 1 para todas
--    as suas source photos (deterministico).
-- 3. Qualquer outra row legacy de pedido multi-knife sem associacao
--    deterministica faz a migration FALAR (guarda abaixo). Nao inventamos
--    associacao.

-- Guarda 1: nenhuma source photo legada pode pertencer a pedido multi-knife
-- fora o fixture de teste explicitamente excluido acima.
do $$
declare
  v_multi integer;
begin
  select count(*) into v_multi
  from public.order_images oi
  join public.orders o on o.id = oi.order_id
  where oi.kind = 'source'
    and oi.knife_index is null
    and o.knife_quantity <> 1
    and o.id <> '723a31ab-7de7-4f11-8983-2903fd7360cb'::uuid;
  if v_multi > 0 then
    raise exception 'LEGACY_MULTI_KNIFE_SOURCE_ROWS: % rows sem associacao deterministica', v_multi;
  end if;
end;
$$;

-- Exclusao do fixture de teste residual (identificado e aprovado):
-- e-mail test-upload-*@example.com, 2 facas, 2 fotos, pending/paid.
delete from public.order_images
  where order_id = '723a31ab-7de7-4f11-8983-2903fd7360cb'::uuid;
delete from public.orders
  where id = '723a31ab-7de7-4f11-8983-2903fd7360cb'::uuid;

-- Guarda 2: o fixture nao pode reaparecer com rows residuais em outras
-- tabelas dependentes diretas de orders (payments, order_revisions).
do $$
declare
  v_resid integer;
begin
  select count(*) into v_resid
  from public.payments
  where order_id = '723a31ab-7de7-4f11-8983-2903fd7360cb'::uuid;
  select count(*) into v_resid from public.order_revisions
  where order_id = '723a31ab-7de7-4f11-8983-2903fd7360cb'::uuid;
  if v_resid > 0 then
    raise exception 'FIXTURE_RESIDUAL_ROWS: % rows dependentes restantes', v_resid;
  end if;
end;
$$;

-- Backfill deterministico: knife_index = 1 para single-knife legado.
update public.order_images oi
  set knife_index = 1
  where oi.kind = 'source'
    and oi.knife_index is null
    and exists (
      select 1 from public.orders o
      where o.id = oi.order_id and o.knife_quantity = 1
    );

-- Agora a constraint da 0008 pode ser validada contra os dados.
alter table public.order_images
  validate constraint order_images_source_requires_knife;