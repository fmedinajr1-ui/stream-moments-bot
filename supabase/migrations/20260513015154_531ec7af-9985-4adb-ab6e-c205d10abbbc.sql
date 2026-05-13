
-- Rekey chat_velocity from clip_id-only to its own surface, keyed by source + time.
-- Existing rows are 0; safe to drop and recreate.
DROP TABLE IF EXISTS public.chat_velocity;

CREATE TABLE public.chat_velocity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  msgs_per_sec numeric NOT NULL,
  baseline_msgs_per_sec numeric,
  spike_ratio numeric,
  is_spike boolean NOT NULL DEFAULT false,
  sample_messages jsonb,
  peak_window text,
  clip_id uuid
);
CREATE INDEX idx_chat_velocity_source_time ON public.chat_velocity (source_id, created_at DESC);
CREATE INDEX idx_chat_velocity_spikes ON public.chat_velocity (source_id, created_at DESC) WHERE is_spike = true;

ALTER TABLE public.chat_velocity ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.chat_velocity FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.clips
  ADD COLUMN IF NOT EXISTS chat_spike_ratio numeric,
  ADD COLUMN IF NOT EXISTS matched_velocity_id uuid,
  ADD COLUMN IF NOT EXISTS score_rationale text;

ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS spike_sensitivity numeric NOT NULL DEFAULT 2.0;

-- Private bucket for nightly training-data CSV exports
INSERT INTO storage.buckets (id, name, public)
VALUES ('training-data', 'training-data', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "training_data_read_all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'training-data');
