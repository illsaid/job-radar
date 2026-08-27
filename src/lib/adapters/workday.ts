import type { AdapterFetchOptions, JobSourceAdapter, NormalizedJob } from './types';
import { stripHtml } from './public-html';

interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string | null;
  postedOn?: string | null;
  remoteType?: string | null;
  timeType?: string | null;
  bulletFields?: string[] | null;
}

interface WorkdayListingResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

interface WorkdayDetailResponse {
  jobPostingInfo?: {
    jobDescription?: string | null;
    location?: string | null;
    remoteType?: string | null;
    timeType?: string | null;
    jobReqId?: string | null;
    externalUrl?: string | null;
  };
}

export interface WorkdayJobDetail {
  descriptionText: string | null;
  descriptionHtml: string | null;
  locationText: string | null;
  remoteStatus: string | null;
  employmentType: string | null;
  jobUrl: string | null;
  sourceJobId: string | null;
}

/**
 * Workday public CXS adapter. `atsIdentifier` is the CXS base URL:
 * https://{host}/wday/cxs/{tenant}/{site}
 */
export class WorkdayAdapter implements JobSourceAdapter {
  readonly name = 'workday';

  async fetchJobs({ atsIdentifier, careersUrl }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const cxsBase = workdayCxsBase(atsIdentifier);
    const postings: WorkdayPosting[] = [];
    let total: number | null = null;
    let offset = 0;

    do {
      const response = await fetch(`${cxsBase}/jobs`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      });
      if (!response.ok) throw new Error(`Workday CXS listing fetch failed: ${response.status} for ${cxsBase}`);
      const page = await response.json() as WorkdayListingResponse;
      if (total === null) total = Number(page.total ?? 0);
      const jobs = page.jobPostings ?? [];
      if (jobs.length === 0) break;
      postings.push(...jobs);
      offset += 20;
    } while (offset < total);

    const seen = new Set<string>();
    return postings.flatMap((posting) => {
      const sourceJobId = workdaySourceJobId(posting);
      const externalPath = posting.externalPath;
      if (!sourceJobId || !posting.title || !externalPath || seen.has(sourceJobId)) return [];
      seen.add(sourceJobId);
      const jobUrl = publicJobUrl(careersUrl, externalPath);
      return [{
        source: this.name,
        source_job_id: sourceJobId,
        title: posting.title,
        department: null,
        team: null,
        location_text: posting.locationsText ?? null,
        remote_status: workdayRemoteStatus(posting.remoteType),
        employment_type: posting.timeType ?? null,
        compensation_min: null,
        compensation_max: null,
        compensation_currency: 'USD',
        description_text: null,
        description_html: null,
        job_url: jobUrl,
        apply_url: jobUrl,
        // Workday's listing value is relative (for example, "Posted Today").
        // It is intentionally not converted into an unverified absolute date.
        source_published_at: null,
        source_updated_at: null,
      }];
    });
  }
}

export async function fetchWorkdayJobDetail(atsIdentifier: string, jobUrl: string): Promise<WorkdayJobDetail> {
  const jobPath = workdayJobPath(jobUrl);
  if (!jobPath) return emptyWorkdayDetail();
  const response = await fetch(`${workdayCxsBase(atsIdentifier)}${jobPath}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) return emptyWorkdayDetail();
  const info = (await response.json() as WorkdayDetailResponse).jobPostingInfo;
  const descriptionHtml = info?.jobDescription ?? null;
  return {
    descriptionText: descriptionHtml ? stripHtml(descriptionHtml) : null,
    descriptionHtml,
    locationText: info?.location ?? null,
    remoteStatus: workdayRemoteStatus(info?.remoteType),
    employmentType: info?.timeType ?? null,
    jobUrl: info?.externalUrl ?? null,
    sourceJobId: info?.jobReqId ?? null,
  };
}

export function workdayCxsBase(atsIdentifier: string): string {
  const parsed = new URL(atsIdentifier);
  const pathname = parsed.pathname.replace(/\/jobs\/?$/, '').replace(/\/$/, '');
  if (!/^\/wday\/cxs\/[^/]+\/[^/]+$/i.test(pathname)) {
    throw new Error(`Invalid Workday CXS base URL: ${atsIdentifier}`);
  }
  return `${parsed.origin}${pathname}`;
}

export function workdayJobPath(jobUrl: string): string | null {
  const path = new URL(jobUrl).pathname;
  return /\/job\/.+$/i.exec(path)?.[0] ?? null;
}

function workdaySourceJobId(posting: WorkdayPosting): string | null {
  const bulletId = posting.bulletFields?.find((value) => value.trim().length > 0);
  if (bulletId) return bulletId.trim();
  return /_([^/_]+)$/.exec(posting.externalPath ?? '')?.[1] ?? null;
}

function publicJobUrl(careersUrl: string, externalPath: string): string {
  return `${careersUrl.replace(/\/$/, '')}/${externalPath.replace(/^\//, '')}`;
}

function workdayRemoteStatus(value: string | null | undefined): string | null {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.includes('remote')) return 'Remote';
  if (normalized.includes('hybrid')) return 'Hybrid';
  if (normalized.includes('on-site') || normalized.includes('onsite')) return 'On-site';
  return null;
}

function emptyWorkdayDetail(): WorkdayJobDetail {
  return {
    descriptionText: null,
    descriptionHtml: null,
    locationText: null,
    remoteStatus: null,
    employmentType: null,
    jobUrl: null,
    sourceJobId: null,
  };
}
