ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'possession',
  ADD COLUMN IF NOT EXISTS game_type text;
NOTIFY pgrst, 'reload schema';