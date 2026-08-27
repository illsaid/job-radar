export interface Company {
  id: string;
  name: string;
  careers_url: string;
  ats_type: string;
  ats_identifier: string | null;
  priority: number;
  enabled: boolean;
  tags: string[];
  notes: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  company_id: string;
  source: string;
  source_job_id: string;
  title: string;
  department: string | null;
  team: string | null;
  location_text: string | null;
  remote_status: string | null;
  employment_type: string | null;
  compensation_min: number | null;
  compensation_max: number | null;
  compensation_currency: string;
  description_text: string | null;
  description_html: string | null;
  job_url: string | null;
  apply_url: string | null;
  source_published_at: string | null;
  source_updated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  content_hash: string;
  source_fingerprint: string | null;
  last_material_change_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ComponentScores {
  production_operations: number;
  ai_workflow: number;
  media_domain: number;
  leadership: number;
  transferability: number;
  seniority: number;
  location: number;
}

export interface JobScore {
  id: string;
  job_id: string;
  total_score: number;
  recommendation: string;
  confidence: string;
  component_scores_json: ComponentScores;
  strengths_json: string[];
  gaps_json: string[];
  penalties_json: Array<{ reason: string; points: number }>;
  hiring_manager_thesis: string | null;
  model_used: string | null;
  created_at: string;
}

export interface ApplicationPacket {
  id: string;
  job_id: string;
  packet_json: Record<string, unknown>;
  packet_markdown: string | null;
  source_content_hash: string | null;
  source_score_id: string | null;
  model_used: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface Alert {
  id: string;
  job_id: string;
  alert_type: string;
  sent_at: string;
  recipient: string;
  unique_key: string;
  source_content_hash: string | null;
}

export interface Application {
  id: string;
  job_id: string;
  status: string;
  notes: string | null;
  applied_at: string | null;
  updated_at: string;
}

export interface SystemRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  companies_checked: number;
  jobs_seen: number;
  new_jobs: number;
  jobs_scored: number;
  alerts_sent: number;
  failures_json: Array<{ company?: string; stage?: string; error: string; timestamp: string }>;
  duration_ms: number | null;
}

export type JobWithRelations = Job & {
  company?: Company;
  latest_score?: JobScore | null;
  application?: Application | null;
  packet?: ApplicationPacket | null;
};
