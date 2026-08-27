import { z } from 'zod';

// Normalized job shape — what every adapter produces before entering the database.
export const normalizedJobSchema = z.object({
  source: z.string(),
  source_job_id: z.string(),
  title: z.string(),
  department: z.string().nullable().optional(),
  team: z.string().nullable().optional(),
  location_text: z.string().nullable().optional(),
  remote_status: z.string().nullable().optional(),
  employment_type: z.string().nullable().optional(),
  compensation_min: z.number().nullable().optional(),
  compensation_max: z.number().nullable().optional(),
  compensation_currency: z.string().optional().default('USD'),
  description_text: z.string().nullable().optional(),
  description_html: z.string().nullable().optional(),
  job_url: z.string().nullable().optional(),
  apply_url: z.string().nullable().optional(),
  source_published_at: z.string().nullable().optional(),
  source_updated_at: z.string().nullable().optional(),
});

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export interface AdapterFetchOptions {
  atsIdentifier: string;
  careersUrl: string;
}

export interface JobSourceAdapter {
  readonly name: string;
  fetchJobs(options: AdapterFetchOptions): Promise<NormalizedJob[]>;
}

// Compute a content hash for deduplication and change detection.
// Uses a simple djb2 hash — deterministic and sufficient for this purpose.
export function computeContentHash(job: NormalizedJob): string {
  const fields = [
    job.source,
    job.source_job_id,
    job.title,
    job.department ?? '',
    job.location_text ?? '',
    job.description_text ?? '',
  ].join('|');

  let hash = 5381;
  for (let i = 0; i < fields.length; i++) {
    hash = ((hash << 5) + hash + fields.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
