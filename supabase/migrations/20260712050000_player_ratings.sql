-- Player-rating support.
-- plays.player_stats: countable per-possession events for the tracked player
-- (emitted by the judge pass, clamped in code) — the raw material for ratings.
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS player_stats jsonb;

-- One 2K-style rating computed over a set of the user's analyzed possessions.
-- Sub-scores/overall are computed deterministically in code from player_stats;
-- the AI only writes the scouting report.
CREATE TABLE public.ratings (
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
CREATE POLICY "own ratings" ON public.ratings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX ratings_user_idx ON public.ratings(user_id, created_at DESC);
