-- Migration 0027: Fix remove_portfolio_media auth vulnerability
-- The previous version (0026) accepted a caller-supplied admin UUID parameter,
-- which allowed any authenticated user to impersonate an admin by passing
-- an arbitrary user ID. This is a privilege escalation vulnerability.
--
-- Fix: Use auth.uid() directly inside the SECURITY DEFINER function so the
-- caller cannot control which identity is checked. Drop the old 2-arg version
-- and replace with a safe 1-arg version.

-- Step 1: Revoke EXECUTE on the vulnerable 2-arg version from all roles
REVOKE EXECUTE ON FUNCTION public.remove_portfolio_media(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_portfolio_media(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.remove_portfolio_media(UUID, UUID) FROM authenticated;

-- Step 2: Drop the vulnerable 2-arg version
DROP FUNCTION IF EXISTS public.remove_portfolio_media(UUID, UUID);

-- Step 3: Create the secure 1-arg version that uses auth.uid() internally
CREATE OR REPLACE FUNCTION public.remove_portfolio_media(
  p_media_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id    UUID;
  v_is_admin     BOOLEAN;
  v_media        RECORD;
  v_work         RECORD;
  v_remaining    INTEGER;
  v_new_hero_id  UUID;
  v_removed_path TEXT;
BEGIN
  -- 1. Authenticate: get the real caller identity from the JWT session
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Authorize: verify the caller is an admin via profiles table
  SELECT (role = 'admin') INTO v_is_admin
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  -- 3. Lock and fetch the media row
  SELECT pim.id, pim.portfolio_item_id, pim.storage_path, pim.position
  INTO v_media
  FROM public.portfolio_item_media pim
  WHERE pim.id = p_media_id
  FOR UPDATE;

  IF v_media IS NULL THEN
    RAISE EXCEPTION 'Media not found: %', p_media_id;
  END IF;

  -- 4. Lock the parent work
  SELECT pi.id, pi.hero_media_id
  INTO v_work
  FROM public.portfolio_items pi
  WHERE pi.id = v_media.portfolio_item_id
  FOR UPDATE;

  IF v_work IS NULL THEN
    RAISE EXCEPTION 'Parent work not found for media: %', p_media_id;
  END IF;

  -- 5. Count remaining media (excluding the one being removed)
  SELECT COUNT(*) INTO v_remaining
  FROM public.portfolio_item_media
  WHERE portfolio_item_id = v_work.id
    AND id != p_media_id;

  -- 6. Reject if this is the last media
  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'Cannot remove last media: work must have at least 1 image';
  END IF;

  -- 7. Save the storage path before deletion
  v_removed_path := v_media.storage_path;

  -- 8. Delete the media row
  DELETE FROM public.portfolio_item_media WHERE id = p_media_id;

  -- 9. Normalize positions of remaining media to 1..N
  WITH reordered AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY position, id) AS new_position
    FROM public.portfolio_item_media
    WHERE portfolio_item_id = v_work.id
  )
  UPDATE public.portfolio_item_media pim
  SET position = r.new_position
  FROM reordered r
  WHERE pim.id = r.id;

  -- 10. If removed media was the hero, fallback to new position 1
  v_new_hero_id := v_work.hero_media_id;
  IF v_work.hero_media_id = p_media_id THEN
    SELECT id INTO v_new_hero_id
    FROM public.portfolio_item_media
    WHERE portfolio_item_id = v_work.id
      AND position = 1
    LIMIT 1;

    IF v_new_hero_id IS NULL THEN
      -- Should not happen since we checked v_remaining >= 1 above
      RAISE EXCEPTION 'No remaining media to assign as hero after removal';
    END IF;

    UPDATE public.portfolio_items
    SET hero_media_id = v_new_hero_id
    WHERE id = v_work.id;
  END IF;

  -- 11. Return result
  RETURN jsonb_build_object(
    'removed_storage_path', v_removed_path,
    'work_id', v_work.id,
    'new_hero_media_id', v_new_hero_id
  );
END;
$$;

-- Step 4: Grant EXECUTE only to authenticated users (admin check is inside)
GRANT EXECUTE ON FUNCTION public.remove_portfolio_media(UUID) TO authenticated;