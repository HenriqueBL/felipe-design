-- Allow temporary negative positions during two-phase reorder.
-- The application layer enforces the 1..3 logical range; the DB check
-- only needs to prevent out-of-bounds values that would corrupt data.
-- Negative values are transient (used by reorder_portfolio_media RPC)
-- and never visible to application reads.
alter table public.portfolio_item_media
drop constraint if exists portfolio_item_media_position_check;

alter table public.portfolio_item_media
add constraint portfolio_item_media_position_check
check (position between -999 and 999);