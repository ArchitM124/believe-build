-- Cleanup: remove the vestigial game-centric schema left over from before the
-- pivot to "a possession is the primary object" (migration 20260711163543).
-- Nothing in the app references games / game_id / camera_angle / game_status.

-- 1) Replace the plays ownership policy with the direct-ownership form only,
--    dropping the legacy branch that reached through the games table.
DROP POLICY IF EXISTS "own plays" ON public.plays;
CREATE POLICY "own plays" ON public.plays
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 2) Drop the now-unused foreign key column, then the table it pointed at.
ALTER TABLE public.plays DROP COLUMN IF EXISTS game_id;
DROP TABLE IF EXISTS public.games;

-- 3) Drop enums that were only used by the games table.
DROP TYPE IF EXISTS public.game_status;
DROP TYPE IF EXISTS public.camera_angle;
