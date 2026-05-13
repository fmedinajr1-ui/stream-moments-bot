
CREATE TABLE public.render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  provider text NOT NULL DEFAULT 'shotstack',
  provider_render_id text,
  vod_url text,
  start_offset_sec numeric,
  duration_sec numeric,
  output_url text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_render_jobs_clip ON public.render_jobs(clip_id);
CREATE INDEX idx_render_jobs_provider_render ON public.render_jobs(provider_render_id);
CREATE INDEX idx_render_jobs_status ON public.render_jobs(status);

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_all" ON public.render_jobs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS rendered_video_url text;

INSERT INTO storage.buckets (id, name, public) VALUES ('clips', 'clips', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "clips read" ON storage.objects FOR SELECT USING (bucket_id = 'clips');
CREATE POLICY "clips write" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'clips');
CREATE POLICY "clips update" ON storage.objects FOR UPDATE USING (bucket_id = 'clips');

ALTER PUBLICATION supabase_realtime ADD TABLE public.render_jobs;
ALTER TABLE public.render_jobs REPLICA IDENTITY FULL;
