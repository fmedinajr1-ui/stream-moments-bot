CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

INSERT INTO public.agent_settings (min_score_threshold, max_clips_per_day, is_paused, blocked_keywords)
SELECT 70, 8, false, '{}'::text[]
WHERE NOT EXISTS (SELECT 1 FROM public.agent_settings);

SELECT cron.unschedule('poll-kick-clips') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='poll-kick-clips');

SELECT cron.schedule(
  'poll-kick-clips',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--f25d50e3-8b88-4a00-abe1-abbf74e02448.lovable.app/api/public/cron/poll-kick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwbW91Y25ob2RtdmRpdXNybWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MjE0NzQsImV4cCI6MjA5NDE5NzQ3NH0.sZQ1O6EEMidU2PNRi-nUl6qwlNIlaQeacEBtPpvan7Q'
    ),
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);