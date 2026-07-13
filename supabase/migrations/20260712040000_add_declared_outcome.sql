-- Optional uploader-declared result ("turnover", "made_shot", ...). When set,
-- the AI anchors on locating/explaining that event (everything after is dead
-- ball) instead of guessing the outcome — its most error-prone job.
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS declared_outcome text;
