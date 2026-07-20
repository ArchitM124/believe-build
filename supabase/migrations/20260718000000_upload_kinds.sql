-- Upload kinds: a row is now a possession clip (default), a jumpshot form
-- check, or a full game (pickup/organized). Games count toward unlocking the
-- hidden overall; jumpshots run the mechanics pipeline.
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'possession',
  ADD COLUMN IF NOT EXISTS game_type text; -- 'pickup' | 'organized' (kind='game')
