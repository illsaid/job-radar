import type { AdapterFetchOptions, JobSourceAdapter, NormalizedJob } from './types';
import { decodeEntities, remoteStatus, stripHtml } from './public-html';

/**
 * SAP SuccessFactors Recruiting Marketing adapter.
 * The tenant OData API is authenticated. SuccessFactors Recruiting Marketing
 * exposes the complete public job feed at /sitemap-job.xml instead, including
 * canonical URLs and full descriptions.
 */
export class SuccessFactorsAdapter implements JobSourceAdapter {
  readonly name = 'successfactors';

  async fetchJobs({ atsIdentifier, careersUrl }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const careers = atsIdentifier || careersUrl;
    const feedUrl = new URL('/sitemap-job.xml', careers).toString();
    const response = await fetch(feedUrl, { headers: { Accept: 'application/xml, text/xml' } });
    if (!response.ok) throw new Error(`SuccessFactors sitemap fetch failed: ${response.status} for ${feedUrl}`);
    const xml = await response.text();
    const jobs: NormalizedJob[] = [];
    const item = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;
    while ((match = item.exec(xml)) !== null) {
      const record = match[1];
      const id = value(record, '(?:g:)?id') ?? value(record, 'guid');
      const titleWithLocation = value(record, 'title');
      const jobUrl = value(record, 'link');
      if (!id || !titleWithLocation || !jobUrl) continue;
      const location = value(record, 'g:location');
      const descriptionHtml = cdata(record, 'description');
      const descriptionText = descriptionHtml ? stripHtml(descriptionHtml) : null;
      const compensation = salaryRange(descriptionText);
      jobs.push({
        source: this.name,
        source_job_id: id,
        title: titleWithLocation.replace(/\s*\([^)]*\)\s*$/, '').trim(),
        department: value(record, 'g:job_function'),
        team: null,
        location_text: location,
        remote_status: remoteStatus(location),
        employment_type: null,
        compensation_min: compensation?.min ?? null,
        compensation_max: compensation?.max ?? null,
        compensation_currency: 'USD',
        description_text: descriptionText,
        description_html: descriptionHtml,
        job_url: jobUrl,
        apply_url: jobUrl,
        source_published_at: null,
        source_updated_at: null,
      });
    }
    return jobs;
  }
}

function value(record: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(record);
  return match ? stripHtml(decodeEntities(match[1])) : null;
}

function cdata(record: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(record);
  if (!match) return null;
  return decodeEntities(match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
}

function salaryRange(text: string | null): { min: number; max: number } | null {
  const match = /\$([\d,]+)(?:\.\d{2})?\s*(?:-|to)\s*\$([\d,]+)(?:\.\d{2})?/i.exec(text ?? '');
  if (!match) return null;
  return { min: Number(match[1].replace(/,/g, '')), max: Number(match[2].replace(/,/g, '')) };
}
