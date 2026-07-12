-- Give the AI the context it currently has to guess at: which team the
-- uploader is analyzing (jersey color) and which way that team is attacking.
-- Feeding these in removes a whole class of "praised the wrong team" errors.
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS team_color text,
  ADD COLUMN IF NOT EXISTS attack_direction text; -- 'left' | 'right' | 'unclear'
