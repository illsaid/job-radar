/*
# Security hardening

1. Fix the set_updated_at function search_path warning from the security advisor.
2. Revoke anon role table grants — only authenticated users should access data.
   RLS policies already restrict to authenticated, but the underlying grants
   give anon full CRUD on all tables. Revoking anon grants adds defense-in-depth.
*/

-- Fix the search_path warning on set_updated_at
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;

-- Revoke all privileges from anon role on all operational tables
-- (RLS already restricts to authenticated, this removes the underlying grants)
REVOKE ALL ON companies FROM anon;
REVOKE ALL ON jobs FROM anon;
REVOKE ALL ON job_snapshots FROM anon;
REVOKE ALL ON job_scores FROM anon;
REVOKE ALL ON application_packets FROM anon;
REVOKE ALL ON alerts FROM anon;
REVOKE ALL ON applications FROM anon;
REVOKE ALL ON system_runs FROM anon;
