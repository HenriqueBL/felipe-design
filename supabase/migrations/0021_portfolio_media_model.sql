-- Ajuste do modelo de mídia do portfolio: before/after deixam de ser
-- obrigatórios para suportar itens com apenas uma imagem principal.
-- Itens legacy (before+after) continuam válidos; novos itens podem usar
-- somente image_storage_path.

-- 1. Relaxar NOT NULL das colunas legadas.
alter table public.portfolio_items
  alter column before_storage_path drop not null;

alter table public.portfolio_items
  alter column after_storage_path drop not null;

-- 2. Garantir que todo item tenha pelo menos uma forma de mídia válida:
--    - imagem principal OU
--    - par before+after completo.
--    A constraint é NO INHERIT e validada apenas em INSERT/UPDATE,
--    preservando rows legacy existentes sem backfill destrutivo.
alter table public.portfolio_items
  add constraint portfolio_items_media_required
  check (
    image_storage_path is not null
    or (before_storage_path is not null and after_storage_path is not null)
  );

-- 3. Índice para consultas que filtram por before/after (gallery legacy).
create index if not exists portfolio_items_before_after_idx
  on public.portfolio_items (before_storage_path, after_storage_path)
  where before_storage_path is not null and after_storage_path is not null;