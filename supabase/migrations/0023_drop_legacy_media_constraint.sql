-- Remove legacy media constraint that requires image_storage_path or
-- before/after paths on portfolio_items. The new model uses
-- portfolio_item_media as the authoritative source; this constraint
-- blocks inserts of new-style works that only populate the child table.
-- Safe: backfill already migrated all existing rows to portfolio_item_media.

alter table public.portfolio_items
  drop constraint if exists portfolio_items_media_required;