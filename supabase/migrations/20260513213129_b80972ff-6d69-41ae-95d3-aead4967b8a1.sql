select cron.schedule(
  'backfill-hourly',
  '0 * * * *',
  $$select net.http_post(
    url:='https://project--f25d50e3-8b88-4a00-abe1-abbf74e02448.lovable.app/api/public/cron/backfill',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwbW91Y25ob2RtdmRpdXNybWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2MjE0NzQsImV4cCI6MjA5NDE5NzQ3NH0.sZQ1O6EEMidU2PNRi-nUl6qwlNIlaQeacEBtPpvan7Q"}'::jsonb,
    body:='{}'::jsonb,
    timeout_milliseconds:=120000
  ) as request_id;$$
);