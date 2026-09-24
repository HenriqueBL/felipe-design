-- Migration 0025: Restore strict position enforcement (1..3) with deferrable
-- unique constraint for safe two-phase reorder without invalid temp positions.
--
-- This is the canonical reconciliation migration. After 0022→0023→0024→0025
-- on a clean database, the state must match the current DEV database.

-- Step 1: Ensure all existing positions are valid (1..3).
-- The backfill in 0022 already guarantees this, but be defensive.
UPDATE public.portfolio_item_media
SET position = CASE
  WHEN position < 1 THEN 1
  WHEN position > 3 THEN 3
  ELSE position
END
WHERE position NOT BETWEEN 1 AND 3;

-- Step 2: Drop the widened check constraint from 0024.
ALTER TABLE public.portfolio_item_media
DROP CONSTRAINT IF EXISTS portfolio_item_media_position_check;

-- Step 3: Restore strict position check (1..3).
ALTER TABLE public.portfolio_item_media
ADD CONSTRAINT portfolio_item_media_position_check
CHECK (position BETWEEN 1 AND 3);

-- Step 4: Drop existing unique constraint and recreate as DEFERRABLE.
-- This allows the reorder RPC to update positions within a single transaction
-- without violating uniqueness mid-update. The constraint is checked only
-- at transaction commit time.
ALTER TABLE public.portfolio_item_media
DROP CONSTRAINT IF EXISTS portfolio_item_media_portfolio_item_id_position_key;

ALTER TABLE public.portfolio_item_media
ADD CONSTRAINT portfolio_item_media_portfolio_item_id_position_key
UNIQUE (portfolio_item_id, position)
DEFERRABLE INITIALLY DEFERRED;

-- Step 5: Rewrite reorder_portfolio_media RPC to use WITH ORDINALITY
-- instead of negative temporary positions. The deferrable constraint
-- allows updating positions directly within a single statement.
CREATE OR REPLACE FUNCTION public.reorder_portfolio_media(
  p_portfolio_item_id UUID,
  p_media_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_distinct_count INTEGER;
  v_matching_count INTEGER;
BEGIN
  -- Validate admin access
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  -- Validate non-empty array
  IF p_media_ids IS NULL OR array_length(p_media_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_media_ids must be a non-empty array';
  END IF;

  -- Validate max 3 media
  IF array_length(p_media_ids, 1) > 3 THEN
    RAISE EXCEPTION 'max 3 media per work';
  END IF;

  -- Validate no duplicate IDs in input
  SELECT COUNT(*) INTO v_distinct_count
  FROM unnest(p_media_ids) AS id;

  SELECT COUNT(DISTINCT id) INTO v_count
  FROM unnest(p_media_ids) AS id;

  IF v_count <> v_distinct_count THEN
    RAISE EXCEPTION 'duplicate media ids in reorder list';
  END IF;

  -- Validate all media belong to the specified work
  SELECT COUNT(*) INTO v_matching_count
  FROM public.portfolio_item_media
  WHERE portfolio_item_id = p_portfolio_item_id
    AND id = ANY(p_media_ids);

  IF v_matching_count <> array_length(p_media_ids, 1) THEN
    RAISE EXCEPTION 'media ids do not all belong to the specified work';
  END IF;

  -- Reorder using WITH ORDINALITY: assign new positions based on array order.
  -- The DEFERRABLE constraint allows this single UPDATE to temporarily
  -- violate uniqueness during execution, checking only at statement end.
  UPDATE public.portfolio_item_media AS m
  SET position = ord.new_position::smallint
  FROM (
    SELECT id, ROW_NUMBER() OVER () AS new_position
    FROM unnest(p_media_ids) WITH ORDINALITY AS t(id, ord)
    ORDER BY ord
  ) AS ord
  WHERE m.id = ord.id
    AND m.portfolio_item_id = p_portfolio_item_id;
END;
$$;

-- Step 6: Add FK constraint to ensure hero_media_id belongs to the same work.
-- This prevents cross-work hero references at the database level.
-- First drop any existing constraint to make this idempotent.
ALTER TABLE public.portfolio_items
DROP CONSTRAINT IF EXISTS portfolio_items_hero_media_belongs_to_work;

-- We cannot add a standard FK because hero_media_id references portfolio_item_media
-- but we also need to verify it belongs to the SAME work. Use a trigger instead.
CREATE OR REPLACE FUNCTION public.validate_hero_media_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.hero_media_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.portfolio_item_media
      WHERE id = NEW.hero_media_id
        AND portfolio_item_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'hero_media_id must belong to the same work';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_hero_media_ownership ON public.portfolio_items;
CREATE TRIGGER trg_validate_hero_media_ownership
BEFORE INSERT OR UPDATE OF hero_media_id ON public.portfolio_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_hero_media_ownership();