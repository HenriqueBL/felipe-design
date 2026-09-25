-- Migration 0026: Atomic remove_portfolio_media RPC
-- Replaces multi-query TypeScript implementation with single server-side transaction.
-- Handles: last-media rejection, hero fallback to position 1, position normalization,
-- storage path return for safe cleanup.

CREATE OR REPLACE FUNCTION remove_portfolio_media(
  p_media_id UUID,
  p_admin_user_id UUID
)
RETURNS TABLE (
  removed_storage_path TEXT,
  work_id UUID,
  new_hero_media_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_media RECORD;
  v_work RECORD;
  v_remaining_count INT;
  v_new_hero RECORD;
BEGIN
  -- 1. Verify admin role
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_admin_user_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Not authorized: admin role required';
  END IF;

  -- 2. Lock and fetch the media row
  SELECT pim.id, pim.portfolio_item_id, pim.storage_path, pim.position
  INTO v_media
  FROM public.portfolio_item_media pim
  WHERE pim.id = p_media_id
  FOR UPDATE;

  IF v_media IS NULL THEN
    RAISE EXCEPTION 'Media not found: %', p_media_id;
  END IF;

  -- 3. Lock the parent work
  SELECT pi.id, pi.hero_media_id
  INTO v_work
  FROM public.portfolio_items pi
  WHERE pi.id = v_media.portfolio_item_id
  FOR UPDATE;

  IF v_work IS NULL THEN
    RAISE EXCEPTION 'Parent work not found for media: %', p_media_id;
  END IF;

  -- 4. Count remaining media (excluding this one)
  SELECT COUNT(*)
  INTO v_remaining_count
  FROM public.portfolio_item_media
  WHERE portfolio_item_id = v_media.portfolio_item_id
    AND id != p_media_id;

  -- 5. Reject if this is the last media
  IF v_remaining_count = 0 THEN
    RAISE EXCEPTION 'Cannot remove the last media from a work';
  END IF;

  -- 6. Store the removed storage path for return
  removed_storage_path := v_media.storage_path;
  work_id := v_work.id;

  -- 7. Delete the media row
  DELETE FROM public.portfolio_item_media
  WHERE id = p_media_id;

  -- 8. Normalize remaining positions to 1..N
  WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position ASC) AS new_pos
    FROM public.portfolio_item_media
    WHERE portfolio_item_id = v_media.portfolio_item_id
  )
  UPDATE public.portfolio_item_media pim
  SET position = ordered.new_pos
  FROM ordered
  WHERE pim.id = ordered.id
    AND pim.position != ordered.new_pos;

  -- 9. Hero fallback: if removed media was the hero, select new position 1
  IF v_work.hero_media_id = p_media_id THEN
    SELECT pim.id
    INTO v_new_hero
    FROM public.portfolio_item_media pim
    WHERE pim.portfolio_item_id = v_media.portfolio_item_id
    ORDER BY pim.position ASC
    LIMIT 1;

    IF v_new_hero IS NOT NULL THEN
      UPDATE public.portfolio_items
      SET hero_media_id = v_new_hero.id
      WHERE id = v_work.id;

      new_hero_media_id := v_new_hero.id;
    ELSE
      -- Should not happen since we checked remaining_count > 0
      new_hero_media_id := NULL;
    END IF;
  ELSE
    -- Hero unchanged
    new_hero_media_id := v_work.hero_media_id;
  END IF;

  RETURN NEXT;
END;
$$;

-- Grant execute to authenticated users (RLS + admin check inside function)
GRANT EXECUTE ON FUNCTION remove_portfolio_media(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION remove_portfolio_media(UUID, UUID) IS
  'Atomically removes a portfolio media item with hero fallback and position normalization. Returns removed_storage_path for safe storage cleanup.';