CREATE TABLE public.marked_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now(),
  duration_sec integer NOT NULL DEFAULT 30,
  caption text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  resolved_clip_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_marked_moments_status ON public.marked_moments (status, marked_at DESC);
CREATE INDEX idx_marked_moments_source ON public.marked_moments (source_id, marked_at DESC);

ALTER TABLE public.marked_moments ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.marked_moments FOR ALL USING (true) WITH CHECK (true);