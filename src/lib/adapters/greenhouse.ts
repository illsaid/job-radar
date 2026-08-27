import type { JobSourceAdapter, NormalizedJob, AdapterFetchOptions } from './types';

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string } | null;
  updated_at: string;
  first_published: string | null;
  metadata?: Array<{ name: string; value: string } | null>;
}

interface GreenhouseDepartment {
  id: number;
  name: string;
  jobs: GreenhouseJob[];
}

interface GreenhouseResponse {
  departments: GreenhouseDepartment[];
}

/**
 * Greenhouse adapter.
 * Public endpoint: https://boards-api.greenhouse.io/v1/boards/{board}/departments
 * The response nests jobs inside each department. We flatten them and map
 * the department name back onto each job.
 * These are public, unauthenticated endpoints intended for embedding job boards.
 */
export class GreenhouseAdapter implements JobSourceAdapter {
  readonly name = 'greenhouse';

  async fetchJobs({ atsIdentifier }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const board = atsIdentifier;
    const url = `https://boards-api.greenhouse.io/v1/boards/${board}/departments`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Greenhouse fetch failed: ${response.status} for board "${board}"`);
    }

    const data: GreenhouseResponse = await response.json();

    // Flatten jobs from all departments, carrying the department name
    const allJobs: Array<GreenhouseJob & { departmentName: string | null }> = [];
    for (const dept of data.departments ?? []) {
      for (const job of dept.jobs ?? []) {
        allJobs.push({ ...job, departmentName: dept.name });
      }
    }

    return allJobs.map((job): NormalizedJob => {
      const locationName = job.location?.name ?? null;

      return {
        source: 'greenhouse',
        source_job_id: String(job.id),
        title: job.title,
        department: job.departmentName,
        team: null,
        location_text: locationName,
        remote_status: detectRemote(locationName),
        employment_type: extractMetadata(job.metadata, 'Employment Type'),
        compensation_min: null,
        compensation_max: null,
        compensation_currency: 'USD',
        description_text: null,
        description_html: null,
        job_url: job.absolute_url ?? null,
        apply_url: job.absolute_url ?? null,
        source_published_at: job.first_published ?? null,
        source_updated_at: job.updated_at ?? null,
      };
    });
  }
}

function extractMetadata(metadata: GreenhouseJob['metadata'], name: string): string | null {
  if (!metadata) return null;
  const entry = metadata.find((m) => m?.name === name);
  return entry?.value ?? null;
}

function detectRemote(location: string | null): string | null {
  if (!location) return null;
  const lower = location.toLowerCase();
  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('hybrid')) return 'Hybrid';
  return null;
}
