ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS spike_window_sec integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS spike_min_mps numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS auto_grab_cooldown_sec integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS auto_grab_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS auto_grabbed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_clips_source_auto_created
  ON public.clips (source_id, auto_grabbed, created_at DESC);