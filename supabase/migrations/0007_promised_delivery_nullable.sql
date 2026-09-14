-- Migration 0007: promised_delivery_date deve aceitar NULL ate ready_for_production.
-- A migration 0006 original inseria NULL nesta coluna via create_order, mas o schema
-- da migration 0001 definia NOT NULL. Esta migration corrige o contrato sem quebrar
-- bancos onde a alteracao ja foi aplicada manualmente (idempotente).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'promised_delivery_date'
      and is_nullable = 'NO'
  ) then
    alter table public.orders alter column promised_delivery_date drop not null;
  end if;
end;
$$;