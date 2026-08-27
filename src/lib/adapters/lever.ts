import type { JobSourceAdapter, NormalizedJob, AdapterFetchOptions } from './types';

// Lever public postings API response shape
// With mode=json, the API returns a flat JSON array of postings (not { postings: [...] })
interface LeverPosting {
  id: string;
  text: string;
  descriptionPlain: string | null;
  description: string | null;
  descriptionBody: string | null;
  descriptionBodyPlain: string | null;
  additional: string | null;
  additionalPlain: string | null;
  lists: unknown[] | null;
  categories: {
    team: string | null;
    department: string | null;
    location: string | null;
    commitment: string | null;
    level: string | null;
  } | null;
  country: string | null;
  workplaceType: string | null;
  hostedUrl: string;
  applyUrl: string | null;
  createdAt: number;
  opening: string | null;
  openingPlain: string | null;
  compensation?: {
    code: string;
    min: number;
    max: number;
    currency: string;
  } | null;
}

/**
 * Lever adapter.
 * Public endpoint: https://api.lever.co/v0/postings/{company}?mode=json
 * Lever's public, unauthenticated job board API.
 * With mode=json, returns a flat JSON array of posting objects.
 */
export class LeverAdapter implements JobSourceAdapter {
  readonly name = 'lever';

  async fetchJobs({ atsIdentifier }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const company = atsIdentifier;
    const url = `https://api.lever.co/v0/postings/${company}?mode=json`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Lever fetch failed: ${response.status} for company "${company}"`);
    }

    const data: unknown = await response.json();
    // With mode=json, the API returns a flat array of postings
    const postings: LeverPosting[] = Array.isArray(data) ? data : (data as { postings?: LeverPosting[] }).postings ?? [];

    return postings.map((posting): NormalizedJob => {
      const cats = posting.categories;
      const location = cats?.location ?? null;
      const workplace = posting.workplaceType?.toLowerCase() ?? '';
      const remote = workplace.includes('remote') ? 'Remote'
        : workplace.includes('hybrid') ? 'Hybrid'
        : location?.toLowerCase().includes('remote') ? 'Remote'
        : location?.toLowerCase().includes('hybrid') ? 'Hybrid'
        : null;

      return {
        source: 'lever',
        source_job_id: posting.id,
        title: posting.text,
        department: cats?.department ?? null,
        team: cats?.team ?? null,
        location_text: location,
        remote_status: remote,
        employment_type: cats?.commitment ?? null,
        compensation_min: posting.compensation?.min ?? null,
        compensation_max: posting.compensation?.max ?? null,
        compensation_currency: posting.compensation?.currency ?? 'USD',
        description_text: posting.descriptionPlain ?? null,
        description_html: posting.description ?? null,
        job_url: posting.hostedUrl ?? null,
        apply_url: posting.applyUrl ?? posting.hostedUrl ?? null,
        source_published_at: posting.createdAt ? new Date(posting.createdAt).toISOString() : null,
        source_updated_at: null,
      };
    });
  }
}
