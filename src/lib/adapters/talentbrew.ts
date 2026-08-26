import type { AdapterFetchOptions, JobSourceAdapter, NormalizedJob } from './types';
import { extractJobLinks, fetchListingPages, listingJob } from './public-html';

/**
 * TalentBrew public careers adapter.
 * TalentBrew does not provide a documented unauthenticated JSON feed for these
 * tenant sites. Its public, server-rendered search and job-detail pages are the
 * stable source; details are enriched after the deterministic prefilter.
 */
export class TalentBrewAdapter implements JobSourceAdapter {
  readonly name = 'talentbrew';

  async fetchJobs({ atsIdentifier, careersUrl }: AdapterFetchOptions): Promise<NormalizedJob[]> {
    const listingUrl = atsIdentifier || careersUrl;
    const links = await fetchListingPages(listingUrl, (html, pageUrl) =>
      extractJobLinks(
        html,
        pageUrl,
        (url) => /\/job\/(?:[^/]+\/){3}\d+\/?$/i.test(new URL(url).pathname),
        (url) => /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? null,
      ),
    );
    return links.map((link) => listingJob(this.name, link));
  }
}
