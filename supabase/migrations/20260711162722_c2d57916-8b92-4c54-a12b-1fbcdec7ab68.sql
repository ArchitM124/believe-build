
-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  team_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile write" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- games
CREATE TYPE public.game_status AS ENUM ('uploading','processing','ready','failed');
CREATE TYPE public.camera_angle AS ENUM ('sideline','baseline','elevated','other');

CREATE TABLE public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  opponent TEXT,
  game_date DATE,
  camera_angle public.camera_angle NOT NULL DEFAULT 'sideline',
  video_path TEXT,
  duration_seconds INT,
  status public.game_status NOT NULL DEFAULT 'uploading',
  error TEXT,
  processing_cost_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.games TO authenticated;
GRANT ALL ON public.games TO service_role;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own games" ON public.games FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX games_user_idx ON public.games(user_id, created_at DESC);

-- plays
CREATE TYPE public.play_outcome AS ENUM ('made_shot','missed_shot','turnover','defensive_stop','defensive_breakdown','foul','other');
CREATE TYPE public.confidence_level AS ENUM ('low','medium','high');

CREATE TABLE public.plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  possession_index INT NOT NULL,
  start_seconds NUMERIC NOT NULL,
  end_seconds NUMERIC NOT NULL,
  outcome public.play_outcome NOT NULL DEFAULT 'other',
  what_happened TEXT NOT NULL,
  what_went_right TEXT,
  what_went_wrong TEXT,
  alternative TEXT,
  confidence public.confidence_level NOT NULL DEFAULT 'medium',
  flagged BOOLEAN NOT NULL DEFAULT false,
  share_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plays TO authenticated;
GRANT SELECT ON public.plays TO anon; -- share links
GRANT ALL ON public.plays TO service_role;
ALTER TABLE public.plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own plays" ON public.plays FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.games g WHERE g.id = plays.game_id AND g.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.games g WHERE g.id = plays.game_id AND g.user_id = auth.uid()));

-- Public read of a single play row when someone knows the share_id (they'll query by share_id).
-- We still restrict what columns matter via app-level select; RLS just permits read.
CREATE POLICY "public share read" ON public.plays FOR SELECT TO anon USING (true);

CREATE INDEX plays_game_idx ON public.plays(game_id, possession_index);

-- auto-create profile on new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger for games
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER games_updated_at BEFORE UPDATE ON public.games
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
