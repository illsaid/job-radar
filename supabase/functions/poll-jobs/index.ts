// Job Radar — Scheduled Polling Edge Function (v2.1: always-run pipeline + material change)
// Invoked by external cron (Cloudflare Worker) or by an authenticated dashboard user.
// Two authentication paths:
//   1. Cron: Authorization: Bearer <JOB_RADAR_CRON_SECRET>
//   2. Manual: valid Supabase JWT (authenticated user)
// After every successful polling pass, invokes downstream pipeline:
//   poll → score → generate-packets → send-alerts
// Even when zero new jobs were found, so pending work is always drained.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const MAX_CONCURRENCY = 5;
const MAX_JOBS_PER_COMPANY = 100;
const BATCH_INSERT_SIZE = 50;

// ---- Constant-time string comparison ----
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ---- Authentication ----
async function authenticateRequest(
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<{ ok: true; mode: 'cron' | 'manual' } | { ok: false; status: number; message: string }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronSecret = Deno.env.get('JOB_RADAR_CRON_SECRET');

  if (cronSecret && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (constantTimeEquals(token, cronSecret)) {
      return { ok: true, mode: 'cron' };
    }
  }

  if (authHeader.startsWith('Bearer ') && !cronSecret) {
    return { ok: false, status: 401, message: 'JOB_RADAR_CRON_SECRET not configured' };
  }

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token.split('.').length === 3) {
      const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user } } = await tempClient.auth.getUser(token);
      if (user) {
        return { ok: true, mode: 'manual' };
      }
    }
  }

  return { ok: false, status: 401, message: 'Unauthorized: valid cron secret or user JWT required' };
}

// ---- Normalized job interface ----

interface NormalizedJob {
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
}

// Stable listing fingerprint — computed from lightweight listing fields only,
// NOT from enriched description_text. This prevents false-positive hash
// mismatches between the initial listing and the later enriched description.
function computeSourceFingerprint(job: NormalizedJob): string {
  const fields = [
    job.source,
    job.source_job_id,
    job.title,
    job.department ?? '',
    job.location_text ?? '',
    job.remote_status ?? '',
    job.employment_type ?? '',
    job.compensation_min?.toString() ?? '',
    job.compensation_max?.toString() ?? '',
    job.job_url ?? '',
    job.source_published_at ?? '',
    job.source_updated_at ?? '',
  ].join('|');
  let hash = 5381;
  for (let i = 0; i < fields.length; i++) {
    hash = ((hash << 5) + hash + fields.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

// Full content hash — includes description text for snapshot tracking
function computeContentHash(job: NormalizedJob): string {
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

// ---- ATS Adapters ----

interface Company {
  id: string;
  name: string;
  careers_url: string;
  ats_type: string;
  ats_identifier: string | null;
  priority: number;
  enabled: boolean;
  consecutive_failures: number;
}

async function fetchGreenhouse(company: Company): Promise<NormalizedJob[]> {
  const board = company.ats_identifier;
  if (!board) throw new Error('No ATS identifier for Greenhouse');
  const url = 'https://boards-api.greenhouse.io/v1/boards/' + board + '/departments';
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error('Greenhouse ' + resp.status + ' for "' + board + '"');
  const data = await resp.json();
  const allJobs: Array<{ id: number; title: string; absolute_url: string; departmentName: string; location: { name: string } | null; updated_at: string; first_published: string | null; metadata: Array<{ name: string; value: string } | null> | null }> = [];
  for (const dept of data.departments ?? []) {
    for (const job of dept.jobs ?? []) {
      allJobs.push({ ...job, departmentName: dept.name });
    }
  }
  return allJobs.map((job): NormalizedJob => {
    const locationName = job.location?.name ?? null;
    const empType = job.metadata?.find((m: { name: string; value: string } | null) => m?.name === 'Employment Type')?.value ?? null;
    const remote = locationName?.toLowerCase().includes('remote') ? 'Remote'
      : locationName?.toLowerCase().includes('hybrid') ? 'Hybrid' : null;
    return {
      source: 'greenhouse',
      source_job_id: String(job.id),
      title: job.title,
      department: job.departmentName,
      team: null,
      location_text: locationName,
      remote_status: remote,
      employment_type: empType ?? null,
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

async function fetchLever(company: Company): Promise<NormalizedJob[]> {
  const c = company.ats_identifier;
  if (!c) throw new Error('No ATS identifier for Lever');
  const url = 'https://api.lever.co/v0/postings/' + c + '?mode=json';
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error('Lever ' + resp.status + ' for "' + c + '"');
  const data: unknown = await resp.json();
  const postings: Array<{
    id: string; text: string; descriptionPlain: string | null; description: string | null;
    categories: { team: string | null; department: string | null; location: string | null; commitment: string | null } | null;
    workplaceType: string | null;
    hostedUrl: string; applyUrl: string | null; createdAt: number;
    compensation: { min: number; max: number; currency: string } | null;
  }> = Array.isArray(data) ? data : (data as { postings?: typeof data }).postings ?? [];
  return postings.map((p): NormalizedJob => {
    const cats = p.categories;
    const loc = cats?.location ?? null;
    const workplace = p.workplaceType?.toLowerCase() ?? '';
    const remote = workplace.includes('remote') ? 'Remote'
      : workplace.includes('hybrid') ? 'Hybrid'
      : loc?.toLowerCase().includes('remote') ? 'Remote'
      : loc?.toLowerCase().includes('hybrid') ? 'Hybrid' : null;
    return {
      source: 'lever',
      source_job_id: p.id,
      title: p.text,
      department: cats?.department ?? null,
      team: cats?.team ?? null,
      location_text: loc,
      remote_status: remote,
      employment_type: cats?.commitment ?? null,
      compensation_min: p.compensation?.min ?? null,
      compensation_max: p.compensation?.max ?? null,
      compensation_currency: p.compensation?.currency ?? 'USD',
      description_text: p.descriptionPlain ?? null,
      description_html: p.description ?? null,
      job_url: p.hostedUrl ?? null,
      apply_url: p.applyUrl ?? p.hostedUrl ?? null,
      source_published_at: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      source_updated_at: null,
    };
  });
}

async function fetchAshby(company: Company): Promise<NormalizedJob[]> {
  const c = company.ats_identifier;
  if (!c) throw new Error('No ATS identifier for Ashby');
  const url = 'https://api.ashbyhq.com/posting-api/job-board/' + c + '?includeCompensation=true';
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error('Ashby ' + resp.status + ' for "' + c + '"');
  const data = await resp.json();
  return (data.jobs ?? []).map((job: {
    title: string; location: string | null; department: string | null; team: string | null;
    isRemote: boolean | null; workplaceType: string | null;
    descriptionHtml: string | null; descriptionPlain: string | null;
    publishedAt: string | null; employmentType: string | null;
    jobUrl: string | null; applyUrl: string | null;
    compensation?: { summaryComponents?: Array<{ compensationType: string; minValue: number | null; maxValue: number | null; currencyCode: string | null }> } | null;
  }): NormalizedJob => {
    let compMin: number | null = null;
    let compMax: number | null = null;
    let compCurrency = 'USD';
    const salaryComp = job.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary');
    if (salaryComp) {
      compMin = salaryComp.minValue;
      compMax = salaryComp.maxValue;
      compCurrency = salaryComp.currencyCode ?? 'USD';
    }
    const wt = job.workplaceType?.toLowerCase() ?? '';
    const remote = wt.includes('remote') ? 'Remote' : wt.includes('hybrid') ? 'Hybrid' : wt.includes('onsite') ? 'On-site' : (job.isRemote ? 'Remote' : null);
    return {
      source: 'ashby',
      source_job_id: job.jobUrl ?? job.title,
      title: job.title,
      department: job.department,
      team: job.team,
      location_text: job.location,
      remote_status: remote,
      employment_type: job.employmentType,
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

async function fetchSmartRecruiters(company: Company): Promise<NormalizedJob[]> {
  const c = company.ats_identifier;
  if (!c) throw new Error('No ATS identifier for SmartRecruiters');
  const url = 'https://api.smartrecruiters.com/v1/companies/' + c + '/postings?limit=100';
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error('SmartRecruiters ' + resp.status + ' for "' + c + '"');
  const data = await resp.json();
  return (data.content ?? []).map((job: {
    id: string; name: string; department: { label: string } | null; function: { label: string } | null;
    typeOfEmployment: { label: string } | null;
    location: { city: string | null; region: string | null; country: string | null; remote: boolean | null; hybrid: boolean | null; fullLocation: string | null } | null;
    ref: string | null; releasedDate: string | null;
  }): NormalizedJob => {
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
      description_text: null,
      description_html: null,
      job_url: job.ref,
      apply_url: job.ref,
      source_published_at: job.releasedDate,
      source_updated_at: null,
    };
  });
}

// Public career-page adapters. TalentBrew does not expose a documented
// unauthenticated JSON listing API for the tenant sites in this watchlist. Its
// server-rendered public listings are the source of record; full descriptions
// are retrieved from the canonical detail URL after the deterministic prefilter.
function stripPublicHtml(html: string): string {
  return html
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function publicLinks(
  html: string,
  pageUrl: string,
  isJobUrl: (url: string) => boolean,
  jobId: (url: string) => string | null,
): Array<{ id: string; title: string; url: string; context: string; innerHtml: string }> {
  const jobs: Array<{ id: string; title: string; url: string; context: string; innerHtml: string }> = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const url = new URL(match[1].replace(/&amp;/g, '&'), pageUrl).toString();
    if (!isJobUrl(url)) continue;
    const id = jobId(url);
    const title = stripPublicHtml(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(match[2])?.[1] ?? match[2]);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    jobs.push({ id, title, url, context: stripPublicHtml(html.slice(match.index, match.index + 1800)), innerHtml: match[2] });
  }
  return jobs;
}

async function fetchPublicListings(
  company: Company,
  source: string,
  isJobUrl: (url: string) => boolean,
  jobId: (url: string) => string | null,
): Promise<NormalizedJob[]> {
  const startUrl = company.ats_identifier ?? company.careers_url;
  if (!startUrl) throw new Error('No public listing URL configured for ' + source);
  const results: NormalizedJob[] = [];
  const seenJobs = new Set<string>();
  const seenPages = new Set<string>();
  let pageUrl: string | null = startUrl;

  while (pageUrl && seenPages.size < 10 && results.length < MAX_JOBS_PER_COMPANY) {
    if (seenPages.has(pageUrl)) break;
    seenPages.add(pageUrl);
    const response = await fetch(pageUrl, { headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(source + ' public listing ' + response.status + ' for ' + pageUrl);
    const html = await response.text();
    for (const link of publicLinks(html, pageUrl, isJobUrl, jobId)) {
      if (seenJobs.has(link.id)) continue;
      seenJobs.add(link.id);
      const cardLocation = /class=["'][^"']*job-location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(link.innerHtml)?.[1] ?? null;
      const cardDepartment = /class=["'][^"']*(?:division|department)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(link.innerHtml)?.[1] ?? null;
      const cardType = /class=["'][^"']*job-type[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(link.innerHtml)?.[1] ?? null;
      const location = cardLocation ? stripPublicHtml(cardLocation) : /Location\s*:?\s*([^|]{1,180}?)(?=\s+(?:Department|Job Function|Date|Posted|Employment Type|Job Type)|$)/i.exec(link.context)?.[1]?.trim() ?? null;
      const department = cardDepartment ? stripPublicHtml(cardDepartment) : /(?:Department|Job Function)\s*:?\s*([^|]{1,180}?)(?=\s+(?:Location|Date|Posted|Employment Type|Job Type)|$)/i.exec(link.context)?.[1]?.trim() ?? null;
      const employmentType = cardType ? stripPublicHtml(cardType) : /(?:Employment Type|Job Type)\s*:?\s*([^|]{1,100}?)(?=\s+(?:Location|Department|Job Function|Date|Posted)|$)/i.exec(link.context)?.[1]?.trim() ?? null;
      const lowerLocation = location?.toLowerCase() ?? '';
      results.push({
        source,
        source_job_id: link.id,
        title: link.title,
        department,
        team: null,
        location_text: location,
        remote_status: lowerLocation.includes('remote') ? 'Remote' : lowerLocation.includes('hybrid') ? 'Hybrid' : null,
        employment_type: employmentType,
        compensation_min: null,
        compensation_max: null,
        compensation_currency: 'USD',
        description_text: null,
        description_html: null,
        job_url: link.url,
        apply_url: link.url,
        source_published_at: null,
        source_updated_at: null,
      });
      if (results.length >= MAX_JOBS_PER_COMPANY) break;
    }
    const next = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*(?:next|›|»)/i.exec(html);
    const nextHref = next?.[1].replace(/&amp;/g, '&') ?? null;
    pageUrl = nextHref ? new URL(!nextHref.includes('?') && nextHref.includes('&') ? nextHref.replace('&', '?') : nextHref, pageUrl).toString() : null;
  }
  return results;
}

async function fetchTalentBrew(company: Company): Promise<NormalizedJob[]> {
  return fetchPublicListings(
    company,
    'talentbrew',
    (url) => /\/job\/(?:[^/]+\/){3}\d+\/?$/i.test(new URL(url).pathname),
    (url) => /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? null,
  );
}

async function fetchSuccessFactors(company: Company): Promise<NormalizedJob[]> {
  const careers = company.ats_identifier ?? company.careers_url;
  const feedUrl = new URL('/sitemap-job.xml', careers).toString();
  const response = await fetch(feedUrl, { headers: { Accept: 'application/xml, text/xml' } });
  if (!response.ok) throw new Error('SuccessFactors sitemap ' + response.status + ' for ' + feedUrl);
  const xml = await response.text();
  const jobs: NormalizedJob[] = [];
  const item = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  const xmlValue = (record: string, tag: string): string | null => {
    const valueMatch = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(record);
    return valueMatch ? stripPublicHtml(valueMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')) : null;
  };
  while ((match = item.exec(xml)) !== null) {
    const record = match[1];
    const id = xmlValue(record, '(?:g:)?id') ?? xmlValue(record, 'guid');
    const titleWithLocation = xmlValue(record, 'title');
    const jobUrl = xmlValue(record, 'link');
    if (!id || !titleWithLocation || !jobUrl) continue;
    const location = xmlValue(record, 'g:location');
    const descriptionHtml = /<description[^>]*>([\s\S]*?)<\/description>/i.exec(record)?.[1]
      ?.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"') ?? null;
    const descriptionText = descriptionHtml ? stripPublicHtml(descriptionHtml) : null;
    const compensation = /\$([\d,]+)(?:\.\d{2})?\s*(?:-|to)\s*\$([\d,]+)(?:\.\d{2})?/i.exec(descriptionText ?? '');
    const lowerLocation = location?.toLowerCase() ?? '';
    jobs.push({
      source: 'successfactors',
      source_job_id: id,
      title: titleWithLocation.replace(/\s*\([^)]*\)\s*$/, '').trim(),
      department: xmlValue(record, 'g:job_function'),
      team: null,
      location_text: location,
      remote_status: lowerLocation.includes('remote') ? 'Remote' : lowerLocation.includes('hybrid') ? 'Hybrid' : null,
      employment_type: null,
      compensation_min: compensation ? Number(compensation[1].replace(/,/g, '')) : null,
      compensation_max: compensation ? Number(compensation[2].replace(/,/g, '')) : null,
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

const ADAPTERS: Record<string, (company: Company) => Promise<NormalizedJob[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  smartrecruiters: fetchSmartRecruiters,
  talentbrew: fetchTalentBrew,
  successfactors: fetchSuccessFactors,
};

// ---- Bounded concurrency ----

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]);
    }
  });
  await Promise.all(workers);
}

// ---- Pipeline stage invocation ----

interface PipelineResult {
  jobsScored: number;
  alertsSent: number;
  packetsGenerated: number;
  stageFailures: Array<{ stage: string; error: string }>;
}

async function invokePipelineStage(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string
): Promise<{ ok: boolean; data: Record<string, unknown> | null; error: string | null }> {
  try {
    const resp = await fetch(
      supabaseUrl + '/functions/v1/' + functionName,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + serviceRoleKey,
        },
        body: '{}',
      }
    );
    if (resp.ok) {
      const data = await resp.json();
      return { ok: true, data: data as Record<string, unknown>, error: null };
    }
    const errText = await resp.text();
    return { ok: false, data: null, error: 'pipeline:' + functionName + ' returned ' + resp.status + ': ' + errText };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, data: null, error: 'pipeline:' + functionName + ': ' + errorMsg };
  }
}

// ---- Core polling logic ----

interface PollResult {
  runId: string;
  companiesChecked: number;
  jobsSeen: number;
  newJobs: number;
  jobsScored: number;
  alertsSent: number;
  packetsGenerated: number;
  failures: number;
  durationMs: number;
}

async function runPoll(supabaseUrl: string, serviceRoleKey: string): Promise<PollResult> {
  const startTime = Date.now();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runId = crypto.randomUUID();
  const failures: Array<{ company?: string; stage?: string; error: string; timestamp: string }> = [];

  await supabase
    .from('system_runs')
    .insert({ id: runId, started_at: new Date().toISOString() });

  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .eq('enabled', true);

  if (companyError || !companies) {
    throw new Error('Failed to load companies: ' + (companyError?.message ?? 'no data'));
  }

  let totalJobsSeen = 0;
  let totalNewJobs = 0;

  // Process companies with bounded concurrency
  await runWithConcurrency(companies as Company[], MAX_CONCURRENCY, async (company) => {
    const adapter = ADAPTERS[company.ats_type];
    if (!adapter) {
      failures.push({
        company: company.name,
        error: 'No adapter for ATS type "' + company.ats_type + '"',
        timestamp: new Date().toISOString(),
      });
      await supabase
        .from('companies')
        .update({
          last_checked_at: new Date().toISOString(),
          consecutive_failures: company.consecutive_failures + 1,
        })
        .eq('id', company.id);
      return;
    }

    try {
      const allJobs = await adapter(company);
      const jobs = allJobs.slice(0, MAX_JOBS_PER_COMPANY);
      totalJobsSeen += jobs.length;

      const sourceJobIds = jobs.map((j) => j.source_job_id);
      const { data: existingJobs } = await supabase
        .from('jobs')
        .select('id, source_job_id, content_hash, source_fingerprint, first_seen_at, status')
        .eq('company_id', company.id)
        .in('source_job_id', sourceJobIds);

      const existingMap = new Map<string, { id: string; content_hash: string; source_fingerprint: string | null; first_seen_at: string; status: string }>();
      (existingJobs ?? []).forEach((e: { id: string; source_job_id: string; content_hash: string; source_fingerprint: string | null; first_seen_at: string; status: string }) => {
        existingMap.set(e.source_job_id, {
          id: e.id,
          content_hash: e.content_hash,
          source_fingerprint: e.source_fingerprint,
          first_seen_at: e.first_seen_at,
          status: e.status,
        });
      });

      const newJobsToInsert: Record<string, unknown>[] = [];
      const snapshotsToInsert: Record<string, unknown>[] = [];
      const updatesToApply: Array<{ id: string; data: Record<string, unknown> }> = [];
      const changedSnapshots: Array<{ job_id: string; content_hash: string; snapshot_json: unknown }> = [];
      let newCount = 0;
      const now = new Date().toISOString();

      for (const normalizedJob of jobs) {
        const sourceFingerprint = computeSourceFingerprint(normalizedJob);
        const contentHash = computeContentHash(normalizedJob);
        const existing = existingMap.get(normalizedJob.source_job_id);

        if (existing) {
          // Existing job — check for material change using source_fingerprint
          const existingFingerprint = existing.source_fingerprint ?? existing.content_hash;
          const isMaterialChange = existingFingerprint !== sourceFingerprint;

          const updates: Record<string, unknown> = {
            last_seen_at: now,
          };

          if (isMaterialChange) {
            // Material change: update all listing fields, set status to 'new' for reevaluation
            updates.source_fingerprint = sourceFingerprint;
            updates.content_hash = contentHash;
            updates.description_text = normalizedJob.description_text;
            updates.description_html = normalizedJob.description_html;
            updates.title = normalizedJob.title;
            updates.location_text = normalizedJob.location_text;
            updates.remote_status = normalizedJob.remote_status;
            updates.employment_type = normalizedJob.employment_type;
            updates.department = normalizedJob.department;
            updates.team = normalizedJob.team;
            updates.compensation_min = normalizedJob.compensation_min;
            updates.compensation_max = normalizedJob.compensation_max;
            updates.source_published_at = normalizedJob.source_published_at;
            updates.source_updated_at = normalizedJob.source_updated_at;
            updates.job_url = normalizedJob.job_url;
            updates.apply_url = normalizedJob.apply_url;
            updates.last_material_change_at = now;
            updates.status = 'new';

            changedSnapshots.push({
              job_id: existing.id,
              content_hash: contentHash,
              snapshot_json: normalizedJob,
            });
          }

          updatesToApply.push({ id: existing.id, data: updates });
        } else {
          // New job
          newJobsToInsert.push({
            company_id: company.id,
            source: normalizedJob.source,
            source_job_id: normalizedJob.source_job_id,
            title: normalizedJob.title,
            department: normalizedJob.department,
            team: normalizedJob.team,
            location_text: normalizedJob.location_text,
            remote_status: normalizedJob.remote_status,
            employment_type: normalizedJob.employment_type,
            compensation_min: normalizedJob.compensation_min,
            compensation_max: normalizedJob.compensation_max,
            compensation_currency: normalizedJob.compensation_currency,
            description_text: normalizedJob.description_text,
            description_html: normalizedJob.description_html,
            job_url: normalizedJob.job_url,
            apply_url: normalizedJob.apply_url,
            source_published_at: normalizedJob.source_published_at,
            source_updated_at: normalizedJob.source_updated_at,
            first_seen_at: now,
            last_seen_at: now,
            content_hash: contentHash,
            source_fingerprint: sourceFingerprint,
            status: 'new',
          });
          newCount++;
        }
      }

      // Batch insert new jobs
      for (let i = 0; i < newJobsToInsert.length; i += BATCH_INSERT_SIZE) {
        const batch = newJobsToInsert.slice(i, i + BATCH_INSERT_SIZE);
        const { data: inserted, error: insertError } = await supabase
          .from('jobs')
          .insert(batch)
          .select('id, source_job_id');

        if (insertError) {
          failures.push({
            company: company.name,
            error: 'Batch insert failed: ' + insertError.message,
            timestamp: now,
          });
        } else if (inserted) {
          for (const ins of inserted as Array<{ id: string; source_job_id: string }>) {
            const originalJob = jobs.find((j) => j.source_job_id === ins.source_job_id);
            if (originalJob) {
              snapshotsToInsert.push({
                job_id: ins.id,
                content_hash: computeContentHash(originalJob),
                snapshot_json: originalJob,
              });
            }
          }
        }
      }

      // Batch insert snapshots for new jobs
      if (snapshotsToInsert.length > 0) {
        for (let i = 0; i < snapshotsToInsert.length; i += BATCH_INSERT_SIZE) {
          await supabase.from('job_snapshots').insert(snapshotsToInsert.slice(i, i + BATCH_INSERT_SIZE));
        }
      }

      // Batch insert snapshots for changed jobs
      if (changedSnapshots.length > 0) {
        for (let i = 0; i < changedSnapshots.length; i += BATCH_INSERT_SIZE) {
          await supabase.from('job_snapshots').insert(changedSnapshots.slice(i, i + BATCH_INSERT_SIZE));
        }
      }

      // Apply updates to existing jobs
      for (const update of updatesToApply) {
        await supabase.from('jobs').update(update.data).eq('id', update.id);
      }

      await supabase
        .from('companies')
        .update({
          last_checked_at: now,
          last_success_at: now,
          consecutive_failures: 0,
        })
        .eq('id', company.id);

      totalNewJobs += newCount;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failures.push({
        company: company.name,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });

      await supabase
        .from('companies')
        .update({
          last_checked_at: new Date().toISOString(),
          consecutive_failures: company.consecutive_failures + 1,
        })
        .eq('id', company.id);
    }
  });

  // ---- Always invoke downstream pipeline (even with 0 new jobs) ----
  let jobsScored = 0;
  let alertsSent = 0;
  let packetsGenerated = 0;

  // Stage 1: Score pending jobs
  const scoreResult = await invokePipelineStage(supabaseUrl, serviceRoleKey, 'score-jobs');
  if (scoreResult.ok && scoreResult.data) {
    jobsScored = (scoreResult.data.scored as number) ?? 0;
  } else if (scoreResult.error) {
    failures.push({ stage: 'pipeline:score-jobs', error: scoreResult.error, timestamp: new Date().toISOString() });
  }

  // Stage 2: Generate/update packets
  const packetResult = await invokePipelineStage(supabaseUrl, serviceRoleKey, 'generate-packets');
  if (packetResult.ok && packetResult.data) {
    packetsGenerated = (packetResult.data.packetsGenerated as number) ?? 0;
  } else if (packetResult.error) {
    failures.push({ stage: 'pipeline:generate-packets', error: packetResult.error, timestamp: new Date().toISOString() });
  }

  // Stage 3: Send alerts
  const alertResult = await invokePipelineStage(supabaseUrl, serviceRoleKey, 'send-alerts');
  if (alertResult.ok && alertResult.data) {
    alertsSent = (alertResult.data.alertsSent as number) ?? 0;
  } else if (alertResult.error) {
    failures.push({ stage: 'pipeline:send-alerts', error: alertResult.error, timestamp: new Date().toISOString() });
  }

  // Complete the system run
  const durationMs = Date.now() - startTime;
  await supabase
    .from('system_runs')
    .update({
      completed_at: new Date().toISOString(),
      companies_checked: companies.length,
      jobs_seen: totalJobsSeen,
      new_jobs: totalNewJobs,
      jobs_scored: jobsScored,
      alerts_sent: alertsSent,
      failures_json: failures,
      duration_ms: durationMs,
    })
    .eq('id', runId);

  return {
    runId,
    companiesChecked: companies.length,
    jobsSeen: totalJobsSeen,
    newJobs: totalNewJobs,
    jobsScored,
    alertsSent,
    packetsGenerated,
    failures: failures.length,
    durationMs,
  };
}

// ---- Main handler ----

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase environment configuration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const auth = await authenticateRequest(req, supabaseUrl, supabaseAnonKey);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ error: auth.message }),
      { status: auth.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const result = await runPoll(supabaseUrl, serviceRoleKey);
    return new Response(
      JSON.stringify({ ...result, triggerMode: auth.mode }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

