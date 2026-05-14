CREATE TABLE public.obs_trigger_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid,
  source_slug text NOT NULL,
  action text NOT NULL DEFAULT 'save_replay',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_obs_trigger_queue_pending ON public.obs_trigger_queue (source_slug, claimed_at, created_at);
ALTER TABLE public.obs_trigger_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.obs_trigger_queue FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.obs_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug text NOT NULL UNIQUE,
  last_polled_at timestamptz,
  last_save_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.obs_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON public.obs_clients FOR ALL USING (true) WITH CHECK (true);