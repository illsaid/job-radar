// Job Radar — Scheduled Polling Edge Function
// Invoked by external cron (Cloudflare Worker) or by an authenticated dashboard user.
// Two authentication paths:
//   1. Cron: Authorization: Bearer <JOB_RADAR_CRON_SECRET>
//   2. Manual: valid Supabase JWT (authenticated user)
// Loads enabled companies, fetches jobs via the correct ATS adapter,
// normalizes, deduplicates, detects changes, updates timestamps, and logs
// the complete system run. One broken company never terminates the run.

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
// Returns { ok: true, mode: 'cron' | 'manual' } or { ok: false, status: number, message: string }
async function authenticateRequest(
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<{ ok: true; mode: 'cron' | 'manual' } | { ok: false; status: number; message: string }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronSecret = Deno.env.get('JOB_RADAR_CRON_SECRET');

  // Path 1: Cron secret
  if (cronSecret && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (constantTimeEquals(token, cronSecret)) {
      return { ok: true, mode: 'cron' };
    }
  }

  // Path 2: Supabase JWT (authenticated user)
  if (authHeader.startsWith('Bearer ') && !cronSecret) {
    // If no cron secret is configured, we can't distinguish — reject
    return { ok: false, status: 401, message: 'JOB_RADAR_CRON_SECRET not configured' };
  }

  // Try to validate as a Supabase JWT
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // Quick check: JWTs have 3 dot-separated parts
    if (token.split('.').length === 3) {
      // Validate the JWT by making a lightweight auth call
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

// ---- Adapter implementations (inlined, no shared code between edge functions) ----

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
}

async function fetchGreenhouse(company: Company): Promise<NormalizedJob[]> {
  const board = company.ats_identifier;
  if (!board) throw new Error('No ATS identifier for Greenhouse');
  const url = `https://boards-api.greenhouse.io/v1/boards/${board}/departments`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Greenhouse ${resp.status} for "${board}"`);
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
  const url = `https://api.lever.co/v0/postings/${c}?mode=json`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Lever ${resp.status} for "${c}"`);
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
  const url = `https://api.ashbyhq.com/posting-api/job-board/${c}?includeCompensation=true`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Ashby ${resp.status} for "${c}"`);
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
  const url = `https://api.smartrecruiters.com/v1/companies/${c}/postings?limit=100`;
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`SmartRecruiters ${resp.status} for "${c}"`);
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

const ADAPTERS: Record<string, (company: Company) => Promise<NormalizedJob[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  smartrecruiters: fetchSmartRecruiters,
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

// ---- Core polling logic (shared by cron and manual trigger) ----

interface PollResult {
  runId: string;
  companiesChecked: number;
  jobsSeen: number;
  newJobs: number;
  jobsScored: number;
  alertsSent: number;
  failures: number;
  durationMs: number;
}

async function runPoll(supabaseUrl: string, serviceRoleKey: string): Promise<PollResult> {
  const startTime = Date.now();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runId = crypto.randomUUID();
  const failures: Array<{ company: string; error: string; timestamp: string }> = [];

  // Insert the system run record
  await supabase
    .from('system_runs')
    .insert({ id: runId, started_at: new Date().toISOString() });

  // Load enabled companies
  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('*')
    .eq('enabled', true);

  if (companyError || !companies) {
    throw new Error(`Failed to load companies: ${companyError?.message ?? 'no data'}`);
  }

  let totalJobsSeen = 0;
  let totalNewJobs = 0;

  // Process companies with bounded concurrency
  await runWithConcurrency(companies as Company[], MAX_CONCURRENCY, async (company) => {
    const adapter = ADAPTERS[company.ats_type];
    if (!adapter) {
      failures.push({
        company: company.name,
        error: `No adapter for ATS type "${company.ats_type}"`,
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

      // Batch fetch all existing jobs for this company in one query
      const sourceJobIds = jobs.map((j) => j.source_job_id);
      const { data: existingJobs } = await supabase
        .from('jobs')
        .select('id, source_job_id, content_hash, first_seen_at')
        .eq('company_id', company.id)
        .in('source_job_id', sourceJobIds);

      const existingMap = new Map<string, { id: string; content_hash: string; first_seen_at: string }>();
      (existingJobs ?? []).forEach((e: { id: string; source_job_id: string; content_hash: string; first_seen_at: string }) => {
        existingMap.set(e.source_job_id, { id: e.id, content_hash: e.content_hash, first_seen_at: e.first_seen_at });
      });

      const newJobsToInsert: Record<string, unknown>[] = [];
      const snapshotsToInsert: Record<string, unknown>[] = [];
      const updatesToApply: Array<{ id: string; data: Record<string, unknown> }> = [];
      const changedSnapshots: Array<{ job_id: string; content_hash: string; snapshot_json: unknown }> = [];
      let newCount = 0;
      const now = new Date().toISOString();

      for (const normalizedJob of jobs) {
        const contentHash = computeContentHash(normalizedJob);
        const existing = existingMap.get(normalizedJob.source_job_id);

        if (existing) {
          const updates: Record<string, unknown> = {
            last_seen_at: now,
          };

          if (existing.content_hash !== contentHash) {
            updates.content_hash = contentHash;
            updates.description_text = normalizedJob.description_text;
            updates.description_html = normalizedJob.description_html;
            updates.title = normalizedJob.title;
            updates.location_text = normalizedJob.location_text;
            updates.source_updated_at = normalizedJob.source_updated_at;
            changedSnapshots.push({
              job_id: existing.id,
              content_hash: contentHash,
              snapshot_json: normalizedJob,
            });
          }

          updatesToApply.push({ id: existing.id, data: updates });
        } else {
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
            status: 'new',
          });
          newCount++;
        }
      }

      // Batch insert new jobs in chunks
      for (let i = 0; i < newJobsToInsert.length; i += BATCH_INSERT_SIZE) {
        const batch = newJobsToInsert.slice(i, i + BATCH_INSERT_SIZE);
        const { data: inserted, error: insertError } = await supabase
          .from('jobs')
          .insert(batch)
          .select('id, source_job_id');

        if (insertError) {
          failures.push({
            company: company.name,
            error: `Batch insert failed: ${insertError.message}`,
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

      // Update company scan status
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

  // After polling, trigger the scoring + alerting pipeline for new jobs.
  let jobsScored = 0;
  let alertsSent = 0;

  if (totalNewJobs > 0) {
    try {
      const scoreResponse = await fetch(
        `${supabaseUrl}/functions/v1/score-jobs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: '{}',
        }
      );
      if (scoreResponse.ok) {
        const scoreData = await scoreResponse.json();
        jobsScored = scoreData.scored ?? 0;
      }
    } catch {
      // Scoring failure is non-fatal
    }

    try {
      const alertResponse = await fetch(
        `${supabaseUrl}/functions/v1/send-alerts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: '{}',
        }
      );
      if (alertResponse.ok) {
        const alertData = await alertResponse.json();
        alertsSent = alertData.alertsSent ?? 0;
      }
    } catch {
      // Alert failure is non-fatal
    }

    try {
      await fetch(
        `${supabaseUrl}/functions/v1/generate-packets`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: '{}',
        }
      );
    } catch {
      // Packet generation failure is non-fatal
    }
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

  // Authenticate the request — cron secret or Supabase JWT
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
