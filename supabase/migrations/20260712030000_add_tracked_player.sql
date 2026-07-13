-- Player-focus mode: a free-text description of ONE player to track and coach
-- personally ("white #23", or for pickup: "gray hoodie, starts left corner").
-- NULL means analyze the whole team (existing behavior).
ALTER TABLE public.plays
  ADD COLUMN IF NOT EXISTS tracked_player text;
