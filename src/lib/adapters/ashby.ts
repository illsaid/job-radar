import type { JobSourceAdapter, NormalizedJob, AdapterFetchOptions } from './types';

// Ashby public job board API response shape
// Endpoint: https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=true
interface AshbyJob {
  title: string;
  location: string | null;
  department: string | null;
  team: string | null;
  isRemote: boolean | null;
  workplaceType: string | null;
  descriptionHtml: string | null;
  descriptionPlain: string | null;
  publishedAt: string | null;
  employmentType: string | null;
  jobUrl: string | null;
  applyUrl: string | null;
  compensation?: {
    summaryComponents?: Array<{
      compensationType: string;
      minValue: number | null;
      maxValue: number | null;
      currencyCode: string | null;
    }>;
  } | null;
}

interface AshbyResponse {
  apiVersion: string;
  jobs: AshbyJob[];
}

/**
 * Ashby adapter.
 * Public endpoint: https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}
 * Ashby's public job posting API, unauthenticated.
 * The job board name is the last path segment of the company's Ashby-hosted careers page.
 */
export class AshbyAdapter implements JobSourceAdapter {
  readonly name = 'ashby';

  async fetchJobs({ atsIdentifier }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const boardName = atsIdentifier;
    const url = `https://api.ashbyhq.com/posting-api/job-board/${boardName}?includeCompensation=true`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Ashby fetch failed: ${response.status} for board "${boardName}"`);
    }

    const data: AshbyResponse = await response.json();

    return (data.jobs ?? []).map((job): NormalizedJob => {
      // Extract salary from compensation summary components
      let compMin: number | null = null;
      let compMax: number | null = null;
      let compCurrency = 'USD';
      const salaryComp = job.compensation?.summaryComponents?.find(
        (c) => c.compensationType === 'Salary'
      );
      if (salaryComp) {
        compMin = salaryComp.minValue;
        compMax = salaryComp.maxValue;
        compCurrency = salaryComp.currencyCode ?? 'USD';
      }

      return {
        source: 'ashby',
        source_job_id: job.jobUrl ?? job.title,
        title: job.title,
        department: job.department,
        team: job.team,
        location_text: job.location,
        remote_status: normalizeWorkplaceType(job.workplaceType, job.isRemote),
        employment_type: normalizeEmploymentType(job.employmentType),
        compensation_min: compMin,
        compensation_max: compMax,
        compensation_currency: compCurrency,
        description_text: job.descriptionPlain,
        description_html: job.descriptionHtml,
        job_url: job.jobUrl,
        apply_url: job.applyUrl ?? job.jobUrl,
        source_published_at: job.publishedAt,
        source_updated_at: null,
      };
    });
  }
}

function normalizeWorkplaceType(type: string | null, isRemote: boolean | null): string | null {
  if (type) {
    const lower = type.toLowerCase();
    if (lower.includes('remote')) return 'Remote';
    if (lower.includes('hybrid')) return 'Hybrid';
    if (lower.includes('onsite')) return 'On-site';
  }
  if (isRemote) return 'Remote';
  return null;
}

function normalizeEmploymentType(type: string | null): string | null {
  if (!type) return null;
  const lower = type.toLowerCase();
  if (lower.includes('fulltime') || lower.includes('full_time')) return 'Full-time';
  if (lower.includes('parttime') || lower.includes('part_time')) return 'Part-time';
  if (lower.includes('contract')) return 'Contract';
  if (lower.includes('intern')) return 'Intern';
  if (lower.includes('temporary')) return 'Temporary';
  return type;
}
