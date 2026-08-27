/*
# Job Radar — core schema

1. Overview
   Job Radar is a private, single-user operations dashboard that detects relevant
   job postings from target company career feeds, normalizes them, deduplicates,
   scores fit against Richard Kuhne's candidate profile, generates application
   packets for strong matches, and emails alerts — all for human review.
   This migration creates the core data model: companies (the watchlist), jobs,
   job_snapshots (change history), job_scores (AI fit analysis), application_packets,
   alerts, applications (manual application tracking), and system_runs (cron logs).

2. New Tables
   - companies: target employer watchlist. Each row is one company whose public
     career feed is polled. Includes ATS metadata, priority, enabled flag, and
     scan-health counters.
   - jobs: normalized job postings from any ATS adapter. Deduplicated by
     (company_id, source, source_job_id). Tracks content_hash to detect changes,
     first_seen_at (when Job Radar first saw it) vs source_published_at (when the
     ATS says it was posted), and a status lifecycle.
   - job_snapshots: immutable history of a job's content each time it changes
     (by content_hash). Supports auditing and re-scoring changed postings.
   - job_scores: structured 0-100 AI fit score per job, with component breakdown,
     recommendation, confidence, strengths, gaps, penalties, and a hiring-manager
     thesis. One-to-many with jobs (latest score is the current view).
   - application_packets: generated application material for strong matches
     (75+). Stored as JSON + markdown for the packet view.
   - alerts: record of email alerts sent, keyed by (job_id, alert_type) via a
     unique constraint to prevent duplicate alerts.
   - applications: manual application status tracking. Human-controlled only —
     Job Radar never auto-applies.
   - system_runs: log of each scheduled poll run with metrics and failure JSON.

3. Security
   - Single-user, auth-required app (Supabase email/password).
   - RLS enabled on every table. Policies scope TO authenticated. Operational
     tables are shared operator-owned state (not per-user), so authenticated
     users can read/write all rows. Auth gating happens by requiring a session.

4. Indexes
   - jobs: unique on (company_id, source, source_job_id) for dedup; indexes on
     status, first_seen_at, content_hash, source_published_at.
   - job_scores: indexes on job_id, created_at, total_score.
   - job_snapshots: indexes on job_id, created_at.
   - alerts: unique on unique_key to prevent duplicate alerts.
   - applications: unique on job_id (one record per job); index on status.
   - companies: indexes on enabled, priority.
   - system_runs: index on started_at desc.

5. Notes
   - All timestamps are timestamptz with sensible defaults.
   - JSONB columns for queryability.
   - content_hash on jobs enables change detection across scans.
   - shared set_updated_at() trigger function applied to companies, jobs,
     application_packets, applications.
*/

-- ============================================================
-- companies
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  careers_url text NOT NULL,
  ats_type text NOT NULL DEFAULT 'generic',
  ats_identifier text,
  priority smallint NOT NULL DEFAULT 2,
  enabled boolean NOT NULL DEFAULT true,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_companies" ON companies;
CREATE POLICY "select_companies" ON companies FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_companies" ON companies;
CREATE POLICY "insert_companies" ON companies FOR INSERT
  TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_companies" ON companies;
CREATE POLICY "update_companies" ON companies FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_companies" ON companies;
CREATE POLICY "delete_companies" ON companies FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_companies_enabled ON companies (enabled);
CREATE INDEX IF NOT EXISTS idx_companies_priority ON companies (priority);

-- ============================================================
-- jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_job_id text NOT NULL,
  title text NOT NULL,
  department text,
  team text,
  location_text text,
  remote_status text,
  employment_type text,
  compensation_min numeric,
  compensation_max numeric,
  compensation_currency text DEFAULT 'USD',
  description_text text,
  description_html text,
  job_url text,
  apply_url text,
  source_published_at timestamptz,
  source_updated_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source, source_job_id)
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_jobs" ON jobs;
CREATE POLICY "select_jobs" ON jobs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_jobs" ON jobs;
CREATE POLICY "insert_jobs" ON jobs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_jobs" ON jobs;
CREATE POLICY "update_jobs" ON jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_jobs" ON jobs;
CREATE POLICY "delete_jobs" ON jobs FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_content_hash ON jobs (content_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_source_published ON jobs (source_published_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company_id);

-- ============================================================
-- job_snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS job_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE job_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_job_snapshots" ON job_snapshots;
CREATE POLICY "select_job_snapshots" ON job_snapshots FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_job_snapshots" ON job_snapshots;
CREATE POLICY "insert_job_snapshots" ON job_snapshots FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_job_snapshots" ON job_snapshots;
CREATE POLICY "update_job_snapshots" ON job_snapshots FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_job_snapshots" ON job_snapshots;
CREATE POLICY "delete_job_snapshots" ON job_snapshots FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_job_snapshots_job ON job_snapshots (job_id);
CREATE INDEX IF NOT EXISTS idx_job_snapshots_created ON job_snapshots (created_at DESC);

-- ============================================================
-- job_scores
-- ============================================================
CREATE TABLE IF NOT EXISTS job_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  total_score integer NOT NULL,
  recommendation text NOT NULL,
  confidence text NOT NULL,
  component_scores_json jsonb NOT NULL DEFAULT '{}',
  strengths_json jsonb NOT NULL DEFAULT '[]',
  gaps_json jsonb NOT NULL DEFAULT '[]',
  penalties_json jsonb NOT NULL DEFAULT '[]',
  hiring_manager_thesis text,
  model_used text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE job_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_job_scores" ON job_scores;
CREATE POLICY "select_job_scores" ON job_scores FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_job_scores" ON job_scores;
CREATE POLICY "insert_job_scores" ON job_scores FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_job_scores" ON job_scores;
CREATE POLICY "update_job_scores" ON job_scores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_job_scores" ON job_scores;
CREATE POLICY "delete_job_scores" ON job_scores FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_job_scores_job ON job_scores (job_id);
CREATE INDEX IF NOT EXISTS idx_job_scores_created ON job_scores (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_scores_total ON job_scores (total_score DESC);

-- ============================================================
-- application_packets
-- ============================================================
CREATE TABLE IF NOT EXISTS application_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  packet_json jsonb NOT NULL DEFAULT '{}',
  packet_markdown text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE application_packets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_application_packets" ON application_packets;
CREATE POLICY "select_application_packets" ON application_packets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_application_packets" ON application_packets;
CREATE POLICY "insert_application_packets" ON application_packets FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_application_packets" ON application_packets;
CREATE POLICY "update_application_packets" ON application_packets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_application_packets" ON application_packets;
CREATE POLICY "delete_application_packets" ON application_packets FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_application_packets_job ON application_packets (job_id);

-- ============================================================
-- alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipient text NOT NULL,
  unique_key text NOT NULL UNIQUE
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_alerts" ON alerts;
CREATE POLICY "select_alerts" ON alerts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_alerts" ON alerts;
CREATE POLICY "insert_alerts" ON alerts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_alerts" ON alerts;
CREATE POLICY "update_alerts" ON alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_alerts" ON alerts;
CREATE POLICY "delete_alerts" ON alerts FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_alerts_job ON alerts (job_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unique_key ON alerts (unique_key);

-- ============================================================
-- applications
-- ============================================================
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'NOT_REVIEWED',
  notes text,
  applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_applications" ON applications;
CREATE POLICY "select_applications" ON applications FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_applications" ON applications;
CREATE POLICY "insert_applications" ON applications FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_applications" ON applications;
CREATE POLICY "update_applications" ON applications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_applications" ON applications;
CREATE POLICY "delete_applications" ON applications FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);

-- ============================================================
-- system_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS system_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  companies_checked integer NOT NULL DEFAULT 0,
  jobs_seen integer NOT NULL DEFAULT 0,
  new_jobs integer NOT NULL DEFAULT 0,
  jobs_scored integer NOT NULL DEFAULT 0,
  alerts_sent integer NOT NULL DEFAULT 0,
  failures_json jsonb NOT NULL DEFAULT '[]',
  duration_ms integer
);

ALTER TABLE system_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_system_runs" ON system_runs;
CREATE POLICY "select_system_runs" ON system_runs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_system_runs" ON system_runs;
CREATE POLICY "insert_system_runs" ON system_runs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_system_runs" ON system_runs;
CREATE POLICY "update_system_runs" ON system_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_system_runs" ON system_runs;
CREATE POLICY "delete_system_runs" ON system_runs FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_system_runs_started ON system_runs (started_at DESC);

-- ============================================================
-- shared updated_at trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_application_packets_updated_at ON application_packets;
CREATE TRIGGER trg_application_packets_updated_at
  BEFORE UPDATE ON application_packets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
