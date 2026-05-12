
-- agent_settings (singleton, public read for single-user app)
CREATE TABLE public.agent_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_paused BOOLEAN NOT NULL DEFAULT false,
  min_score_threshold INT NOT NULL DEFAULT 70,
  max_clips_per_day INT NOT NULL DEFAULT 8,
  blocked_keywords TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.agent_settings (id) VALUES (gen_random_uuid());

CREATE TABLE public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  is_monitoring BOOLEAN NOT NULL DEFAULT true,
  poll_interval_min INT NOT NULL DEFAULT 15,
  last_polled_at TIMESTAMPTZ,
  last_known_live BOOLEAN NOT NULL DEFAULT false,
  follower_count INT,
  avg_viewers INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES public.sources(id) ON DELETE CASCADE,
  kick_clip_id TEXT UNIQUE,
  kick_clip_url TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  title TEXT,
  duration_seconds INT,
  kick_view_count INT,
  stream_timestamp TEXT,
  virality_score INT,
  score_breakdown JSONB DEFAULT '{}'::jsonb,
  hook_caption TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  platforms JSONB NOT NULL DEFAULT '{"ig":true,"tiktok":true,"youtube":true}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE INDEX clips_status_idx ON public.clips(status);
CREATE INDEX clips_source_idx ON public.clips(source_id);

CREATE TABLE public.chat_velocity (
  clip_id UUID PRIMARY KEY REFERENCES public.clips(id) ON DELETE CASCADE,
  msgs_per_sec NUMERIC,
  peak_window TEXT,
  sample_messages JSONB
);

CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  clip_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.download_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES public.clips(id) ON DELETE CASCADE,
  format TEXT,
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  platform TEXT,
  payout_rate TEXT,
  budget_total NUMERIC,
  budget_remaining NUMERIC,
  earnings NUMERIC DEFAULT 0,
  requirements TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: single-user app, allow anon for now (UI-gated). Tighten with auth later.
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_velocity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Open read/write policies (single-operator dashboard, not multi-tenant).
-- TODO: tighten when auth is added.
CREATE POLICY "open_all" ON public.agent_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.clips FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.chat_velocity FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.download_history FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_all" ON public.campaigns FOR ALL USING (true) WITH CHECK (true);

-- Seed sources, template, mock clips
INSERT INTO public.sources (slug, display_name, follower_count, avg_viewers, last_known_live) VALUES
  ('deenthegreat', 'DEEN', 412000, 12847, true),
  ('rampage', 'RAMPAGE', 287000, 8210, false),
  ('ab', 'AB', 156000, 4520, false);

INSERT INTO public.templates (name, settings, is_active) VALUES
  ('FIGHT NIGHT', '{
    "background": "#0A0A0A",
    "hook_color": "#FFFFFF",
    "hook_font": "Bebas Neue",
    "hook_size": 100,
    "hook_y": 12,
    "ticker_accent": "#FFD700",
    "ticker_height": 80,
    "subtitle_font": "Montserrat",
    "subtitle_size": 52,
    "reaction_zoom": true,
    "sound_fx": true
  }'::jsonb, true);

INSERT INTO public.campaigns (name, platform, payout_rate, budget_total, budget_remaining, earnings, status) VALUES
  ('DEEN OFFICIAL CLIPPER PROGRAM', 'Whop', '$150 per 100K views', 2000, 1200, 340, 'active'),
  ('RAMPAGE CLIPS', 'Clipping.net', '$120 per 100K views', 1500, 1500, 0, 'active');
