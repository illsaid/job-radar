import type { JobSourceAdapter, NormalizedJob, AdapterFetchOptions } from './types';

// SmartRecruiters public posting API response shape
// Endpoint: https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings
interface SmartRecruitersJob {
  id: string;
  uuid: string;
  name: string;
  jobAdId: string | null;
  defaultJobAd: boolean | null;
  refNumber: string | null;
  company: { identifier: string; name: string } | null;
  department: { id: string; label: string } | null;
  function: { id: string; label: string } | null;
  typeOfEmployment: { id: string; label: string } | null;
  experienceLevel: { id: string; label: string } | null;
  location: {
    city: string | null;
    region: string | null;
    country: string | null;
    remote: boolean | null;
    hybrid: boolean | null;
    fullLocation: string | null;
  } | null;
  releasedDate: string | null;
  ref: string | null;
  industry: { id: string; label: string } | null;
  customField: Array<{ fieldId: string; fieldLabel: string; valueId: string; valueLabel: string }> | null;
}

interface SmartRecruitersResponse {
  content: SmartRecruitersJob[];
  total: number | null;
}

/**
 * SmartRecruiters adapter.
 * Public endpoint: https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings
 * SmartRecruiters' public posting API, unauthenticated.
 * The company identifier is what appears after the / in careers.smartrecruiters.com/{identifier}
 */
export class SmartRecruitersAdapter implements JobSourceAdapter {
  readonly name = 'smartrecruiters';

  async fetchJobs({ atsIdentifier }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const company = atsIdentifier;
    const url = `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`SmartRecruiters fetch failed: ${response.status} for company "${company}"`);
    }

    const data: SmartRecruitersResponse = await response.json();

    return (data.content ?? []).map((job): NormalizedJob => {
      const loc = job.location;
      const locationText = loc?.fullLocation ?? [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ') ?? null;
      const remoteStatus = loc?.remote ? 'Remote' : loc?.hybrid ? 'Hybrid' : null;

      return {
        source: 'smartrecruiters',
        source_job_id: job.id,
        title: job.name,
        department: job.department?.label ?? null,
        team: job.function?.label ?? null,
        location_text: locationText,
        remote_status: remoteStatus,
        employment_type: job.typeOfEmployment?.label ?? null,
        compensation_min: null,
        compensation_max: null,
        compensation_currency: 'USD',
        description_text: null, // Detail endpoint has full description
        description_html: null,
        job_url: job.ref,
        apply_url: job.ref,
        source_published_at: job.releasedDate,
        source_updated_at: null,
      };
    });
  }
}
