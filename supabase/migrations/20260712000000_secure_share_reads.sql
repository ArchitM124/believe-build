-- Security fix: the previous "public share read" policy allowed ANY anonymous
-- caller (holding the public publishable key) to `SELECT *` on EVERY row of
-- public.plays — leaking every user's notes, video_path, and full breakdown,
-- not just the single possession behind a share link.
--
-- RLS cannot restrict which COLUMNS are returned, nor require that a query
-- filter by share_id. So we move shared reads behind a SECURITY DEFINER RPC
-- that returns only the safe, share-appropriate columns for exactly one row,
-- and we remove all direct anonymous access to the table.

CREATE OR REPLACE FUNCTION public.get_shared_possession(p_share_id uuid)
RETURNS TABLE (
  id uuid,
  title text,
  outcome public.play_outcome,
  what_happened text,
  what_went_right text,
  what_went_wrong text,
  alternative text,
  confidence public.confidence_level,
  share_id uuid,
  duration_seconds integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.title, p.outcome, p.what_happened, p.what_went_right,
    p.what_went_wrong, p.alternative, p.confidence, p.share_id, p.duration_seconds
  FROM public.plays p
  WHERE p.share_id = p_share_id
  LIMIT 1;
$$;

-- Only the RPC is exposed to the public; PUBLIC/authenticated get it too but
-- it only ever returns safe columns for a caller who already knows the share_id.
REVOKE ALL ON FUNCTION public.get_shared_possession(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_possession(uuid) TO anon, authenticated;

-- Remove the over-broad direct table access the RPC now replaces.
DROP POLICY IF EXISTS "public share read" ON public.plays;
REVOKE SELECT ON public.plays FROM anon;
