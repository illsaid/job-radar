/*
# Set up scheduled polling via pg_cron

1. Overview
   Enables pg_cron and pg_net extensions and creates a cron job that invokes
   the poll-jobs edge function every 3 minutes. This drives the automated
   job-feed scanning cycle.

2. Changes
   - Creates pg_cron extension (if not already present).
   - Creates pg_net extension (for HTTP requests from cron).
   - Schedules a cron job named job-radar-poll to call the edge function.

3. Notes
   - The edge function URL is constructed from the project Supabase URL.
   - The anon key is used for authentication (the function has verify_jwt off).
   - Cron schedule uses standard cron syntax for every 3 minutes.
   - This is safe to re-run (idempotent job scheduling via unschedule first).
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('job-radar-poll');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$$;

SELECT cron.schedule(
  'job-radar-poll',
  '*/3 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://0ec90b57d6e95fcbda19832f.supabase.co/functions/v1/poll-jobs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJib2x0IiwicmVmIjoiMGVjOTBiNTdkNmU5NWZjYmRhMTk4MzJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODE1NzQsImV4cCI6MTc1ODg4MTU3NH0.9I8-U0x86Ak8t2DGaIk0HfvTSLsAyzdnz-Nw00mMkKw'
      ),
      body := '{}'::jsonb
    );
  $$
);
