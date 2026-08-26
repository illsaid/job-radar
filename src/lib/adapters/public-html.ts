import type { NormalizedJob } from './types';

export interface PublicJobLink {
  sourceJobId: string;
  title: string;
  jobUrl: string;
  surroundingText: string;
  innerHtml: string;
}

export function stripHtml(html: string): string {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'");
}

export function absoluteUrl(href: string, baseUrl: string): string {
  return new URL(decodeEntities(href), baseUrl).toString();
}

export function extractJobLinks(
  html: string,
  baseUrl: string,
  isJobUrl: (url: string) => boolean,
  sourceJobId: (url: string) => string | null,
): PublicJobLink[] {
  const links: PublicJobLink[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) !== null) {
    const jobUrl = absoluteUrl(match[1], baseUrl);
    if (!isJobUrl(jobUrl)) continue;

    const id = sourceJobId(jobUrl);
    const title = stripHtml(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(match[2])?.[1] ?? match[2]);
    if (!id || !title || seen.has(id)) continue;

    seen.add(id);
    links.push({
      sourceJobId: id,
      title,
      jobUrl,
      surroundingText: stripHtml(html.slice(match.index, match.index + 1800)),
      innerHtml: match[2],
    });
  }

  return links;
}

export function extractNextPageUrl(html: string, baseUrl: string): string | null {
  const next = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*(?:next|›|»)/i.exec(html);
  if (!next) return null;
  const href = decodeEntities(next[1]);
  return absoluteUrl(!href.includes('?') && href.includes('&') ? href.replace('&', '?') : href, baseUrl);
}

export function labelledValue(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s*:?\\s*([^|]{1,180}?)(?=\\s+(?:Department|Job Function|Location|Date|Posted|Employment Type|Job Type)|$)`, 'i').exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function remoteStatus(location: string | null): string | null {
  const lower = location?.toLowerCase() ?? '';
  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('hybrid')) return 'Hybrid';
  if (lower.includes('on-site') || lower.includes('onsite')) return 'On-site';
  return null;
}

export function listingJob(source: string, link: PublicJobLink): NormalizedJob {
  const cardLocation = /class=["'][^"']*job-location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(link.innerHtml)?.[1] ?? null;
  const cardType = /class=["'][^"']*job-type[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(link.innerHtml)?.[1] ?? null;
  const cardDepartment = /class=["'][^"']*(?:division|department)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(link.innerHtml)?.[1] ?? null;
  const location = cardLocation ? stripHtml(cardLocation) : labelledValue(link.surroundingText, ['Location']);
  return {
    source,
    source_job_id: link.sourceJobId,
    title: link.title,
    department: cardDepartment ? stripHtml(cardDepartment) : labelledValue(link.surroundingText, ['Department', 'Job Function']),
    team: null,
    location_text: location,
    remote_status: remoteStatus(location),
    employment_type: cardType ? stripHtml(cardType) : labelledValue(link.surroundingText, ['Employment Type', 'Job Type']),
    compensation_min: null,
    compensation_max: null,
    compensation_currency: 'USD',
    description_text: null,
    description_html: null,
    job_url: link.jobUrl,
    apply_url: link.jobUrl,
    source_published_at: null,
    source_updated_at: null,
  };
}

export async function fetchListingPages(
  startUrl: string,
  parsePage: (html: string, pageUrl: string) => PublicJobLink[],
  maxPages = 10,
): Promise<PublicJobLink[]> {
  const jobs: PublicJobLink[] = [];
  const seenJobs = new Set<string>();
  const visitedPages = new Set<string>();
  let pageUrl: string | null = startUrl;

  while (pageUrl && visitedPages.size < maxPages) {
    if (visitedPages.has(pageUrl)) break;
    visitedPages.add(pageUrl);
    const response = await fetch(pageUrl, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`Public career listing fetch failed: ${response.status} for ${pageUrl}`);
    const html = await response.text();
    for (const job of parsePage(html, pageUrl)) {
      if (!seenJobs.has(job.sourceJobId)) {
        seenJobs.add(job.sourceJobId);
        jobs.push(job);
      }
    }
    pageUrl = extractNextPageUrl(html, pageUrl);
  }

  return jobs;
}
