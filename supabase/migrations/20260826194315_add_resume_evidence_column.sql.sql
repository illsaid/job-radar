-- Add strongest_resume_evidence column to job_scores table
-- The score-jobs edge function validates this field from the model response
-- but previously had no column to store it in.
ALTER TABLE job_scores ADD COLUMN IF NOT EXISTS strongest_resume_evidence_json jsonb DEFAULT '[]'::jsonb;
