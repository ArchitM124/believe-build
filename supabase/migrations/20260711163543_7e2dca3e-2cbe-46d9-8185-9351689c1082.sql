
-- Pivot: possessions are now the primary object.
-- A possession is one uploaded clip, owned directly by the uploader (coach OR player).
-- The `games` table remains for optional future grouping but is no longer required.

CREATE TYPE public.uploader_role AS ENUM ('coach', 'player');
CREATE TYPE public.possession_status AS ENUM ('uploading', 'processing', 'ready', 'failed');

ALTER TABLE public.plays
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN title text,
  ADD COLUMN notes text,
  ADD COLUMN video_path text,
  ADD COLUMN duration_seconds integer,
  ADD COLUMN uploader_role public.uploader_role NOT NULL DEFAULT 'coach',
  ADD COLUMN status public.possession_status NOT NULL DEFAULT 'uploading',
  ADD COLUMN error text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Relax legacy NOT NULLs so a possession can exist before AI analysis fills them in,
-- and independent of a parent game.
ALTER TABLE public.plays ALTER COLUMN game_id DROP NOT NULL;
ALTER TABLE public.plays ALTER COLUMN possession_index DROP NOT NULL;
ALTER TABLE public.plays ALTER COLUMN start_seconds DROP NOT NULL;
ALTER TABLE public.plays ALTER COLUMN end_seconds DROP NOT NULL;
ALTER TABLE public.plays ALTER COLUMN what_happened DROP NOT NULL;

-- Replace the game-based ownership policy with one that accepts either
-- direct ownership (new model) or ownership via the parent game (legacy).
DROP POLICY IF EXISTS "own plays" ON public.plays;
CREATE POLICY "own plays" ON public.plays
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.games g WHERE g.id = plays.game_id AND g.user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.games g WHERE g.id = plays.game_id AND g.user_id = auth.uid())
  );

CREATE TRIGGER set_plays_updated_at
  BEFORE UPDATE ON public.plays
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS plays_user_id_created_at_idx
  ON public.plays (user_id, created_at DESC);
