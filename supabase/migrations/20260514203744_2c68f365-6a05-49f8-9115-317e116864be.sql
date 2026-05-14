ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS live_playback_url text;
ALTER TABLE public.sources ADD COLUMN IF NOT EXISTS live_playback_url_updated_at timestamptz;

ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS raw_storage_path text;
ALTER TABLE public.clips ADD COLUMN IF NOT EXISTS capture_method text NOT NULL DEFAULT 'hls_server';

ALTER TABLE public.agent_settings ADD COLUMN IF NOT EXISTS browser_capture_enabled boolean NOT NULL DEFAULT true;