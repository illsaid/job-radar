/*
# Production Hardening Migration

## Changes:
1. jobs table: add last_material_change_at timestamptz nullable
2. jobs table: add source_fingerprint text nullable (stable listing fingerprint for change detection, separate from content_hash which includes enriched descriptions)
3. application_packets: add source_content_hash text, source_score_id uuid, model_used text, is_current boolean default true
4. application_packets: add unique constraint on job_id WHERE is_current = true (one current packet per job)
5. alerts: drop old unique_key constraint, add new version-aware unique_key
6. alerts: add source_content_hash text column for version-aware dedupe
*/

-- 1. Add last_material_change_at to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_material_change_at timestamptz;

-- 2. Add source_fingerprint to jobs (stable listing fingerprint, not affected by enrichment)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_fingerprint text;

-- 3. Add versioning columns to application_packets
ALTER TABLE application_packets ADD COLUMN IF NOT EXISTS source_content_hash text;
ALTER TABLE application_packets ADD COLUMN IF NOT EXISTS source_score_id uuid;
ALTER TABLE application_packets ADD COLUMN IF NOT EXISTS model_used text;
ALTER TABLE application_packets ADD COLUMN IF NOT EXISTS is_current boolean DEFAULT true;

-- 4. Unique constraint: one current packet per job
DROP INDEX IF EXISTS idx_application_packets_one_current;
CREATE UNIQUE INDEX idx_application_packets_one_current
  ON application_packets (job_id)
  WHERE is_current = true;

-- 5. Drop old alerts unique_key constraint and index
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_unique_key_key;
DROP INDEX IF EXISTS idx_alerts_unique_key;

-- 6. Add source_content_hash to alerts for version-aware dedupe
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_content_hash text;

-- 7. New version-aware unique key: job_id + source_content_hash + alert_type
-- Using a composite key instead of a single text field for robustness
DROP INDEX IF EXISTS alerts_versioned_unique_key;
CREATE UNIQUE INDEX alerts_versioned_unique_key
  ON alerts (job_id, COALESCE(source_content_hash, ''), alert_type);

-- 8. Backfill source_fingerprint for existing jobs from content_hash
UPDATE jobs SET source_fingerprint = content_hash WHERE source_fingerprint IS NULL;
