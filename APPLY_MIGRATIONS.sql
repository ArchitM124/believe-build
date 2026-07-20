-- ============================================================================
-- PlayIQ: apply ALL pending database changes in one shot.
-- Safe to run more than once (idempotent). Run this against the project's
-- Supabase database (Lovable Cloud → database / SQL, or ask Lovable's agent
-- to execute this file).
-- Covers migrations: 20260712000000 → 20260712050000.
-- ============================================================================

-- ---- 1) Secure share reads (replaces over-broad anon SELECT) ---------------
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

REVOKE ALL ON FUNCTION public.get_shared_possession(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_possession(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "public share read" ON public.plays;
REVOKE SELECT ON public.plays FROM anon;

-- ---- 2) Remove the legacy game-centric schema ------------------------------
DROP POLICY IF EXISTS "own plays" ON public.plays;
CREATE POLICY "own plays" ON public.plays
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.plays DROP COLUMN IF EXISTS game_id;
DROP TABLE IF EXISTS public.games;
DROP TYPE IF EXISTS public.game_status;
DROP TYPE IF EXISTS public.camera_angle;

-- ---- 3) AI context columns -------------------------------------------------
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS team_color text,
  ADD COLUMN IF NOT EXISTS attack_direction text;

-- ---- 4) Player-focus mode --------------------------------------------------
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS tracked_player text;

-- ---- 5) Uploader-declared outcome -----------------------------------------
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS declared_outcome text;

-- ---- 6) Player ratings -----------------------------------------------------
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS player_stats jsonb;

CREATE TABLE IF NOT EXISTS public.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tracked_player text NOT NULL,
  play_ids uuid[] NOT NULL,
  possessions_used int NOT NULL,
  sub_scores jsonb NOT NULL,
  overall int NOT NULL,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.ratings TO authenticated;
GRANT ALL ON public.ratings TO service_role;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ratings" ON public.ratings;
CREATE POLICY "own ratings" ON public.ratings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS ratings_user_idx ON public.ratings(user_id, created_at DESC);

-- ---- Done. Ask PostgREST to reload its schema cache ------------------------
NOTIFY pgrst, 'reload schema';

-- ---- 7) Upload kinds (possession / jumpshot / game) ------------------------
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'possession',
  ADD COLUMN IF NOT EXISTS game_type text;
NOTIFY pgrst, 'reload schema';
