// Job Radar — Email Alert Edge Function (Resend)
// Sends email alerts for strong matches (82+) and strong-review matches (75-81).
// High-priority target companies alert at 72+. Never alerts the same job twice.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const HIGH_PRIORITY_THRESHOLD = 72;
const ALERT_RECIPIENT = Deno.env.get('ALERT_RECIPIENT') ?? 'richard@example.com';
const ALERT_FROM = Deno.env.get('ALERT_FROM') ?? 'Job Radar <alerts@jobradar.io>';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase configuration' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!resendApiKey) {
    return new Response(
      JSON.stringify({ error: 'No Resend API key configured. Set RESEND_API_KEY to enable alerts.' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Find jobs that meet alert thresholds and haven't been alerted yet
    const { data: scoredJobs, error } = await supabase
      .from('job_scores')
      .select('*, jobs(*, companies(name, priority))')
      .order('total_score', { ascending: false })
      .limit(50);

    if (error || !scoredJobs) {
      return new Response(
        JSON.stringify({ error: 'Failed to load scored jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let alertsSent = 0;
    const failures: Array<{ job: string; error: string }> = [];

    for (const scoreRow of scoredJobs) {
      const job = scoreRow.jobs as Record<string, unknown> | null;
      if (!job) continue;

      const jobId = job.id as string;
      const score = scoreRow.total_score as number;
      const company = job.companies as { name: string; priority: number } | null;
      const companyPriority = company?.priority ?? 2;

      // Determine if this job should be alerted
      let shouldAlert = false;
      let alertType = '';

      if (score >= 90) {
        shouldAlert = true;
        alertType = 'exceptional';
      } else if (score >= 82) {
        shouldAlert = true;
        alertType = 'apply_now';
      } else if (score >= 75) {
        shouldAlert = true;
        alertType = 'strong_review';
      } else if (score >= HIGH_PRIORITY_THRESHOLD && companyPriority === 1) {
        shouldAlert = true;
        alertType = 'high_priority';
      }

      if (!shouldAlert) continue;

      // Check for duplicate alert — unique_key prevents re-alerting
      const uniqueKey = `${jobId}:${alertType}`;
      const { data: existingAlert } = await supabase
        .from('alerts')
        .select('id')
        .eq('unique_key', uniqueKey)
        .maybeSingle();

      if (existingAlert) continue;

      // Build the email
      const jobTitle = job.title as string;
      const companyName = company?.name ?? 'Unknown';
      const locationText = job.location_text as string | null;
      const remoteStatus = job.remote_status as string | null;
      const jobUrl = job.job_url as string | null;
      const applyUrl = job.apply_url as string | null;
      const sourcePublished = job.source_published_at as string | null;
      const firstSeen = job.first_seen_at as string;

      const strengths = scoreRow.strengths_json as string[];
      const gaps = scoreRow.gaps_json as string[];

      const subject = buildSubject(score, alertType, jobTitle, companyName);
      const htmlBody = buildEmailHtml({
        score,
        recommendation: scoreRow.recommendation as string,
        jobTitle,
        companyName,
        locationText,
        remoteStatus,
        sourcePublished,
        firstSeen,
        strengths,
        gaps,
        jobUrl,
        applyUrl,
        supabaseUrl,
      });

      try {
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: ALERT_FROM,
            to: ALERT_RECIPIENT,
            subject,
            html: htmlBody,
          }),
        });

        if (!resendResponse.ok) {
          const errText = await resendResponse.text();
          failures.push({ job: jobTitle, error: `Resend error: ${errText}` });
          continue;
        }

        // Record the alert
        await supabase.from('alerts').insert({
          job_id: jobId,
          alert_type: alertType,
          recipient: ALERT_RECIPIENT,
          unique_key: uniqueKey,
        });

        alertsSent++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failures.push({ job: jobTitle, error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({ alertsSent, failures, totalProcessed: scoredJobs.length }),
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

function buildSubject(score: number, alertType: string, title: string, company: string): string {
  if (alertType === 'exceptional') {
    return `[${score}] EXCEPTIONAL MATCH — ${title} — ${company}`;
  }
  if (alertType === 'apply_now') {
    return `[${score}] APPLY NOW — ${title} — ${company}`;
  }
  if (alertType === 'strong_review') {
    return `[${score}] Strong fit — ${title} — ${company}`;
  }
  return `[${score}] High-priority match — ${title} — ${company}`;
}

interface EmailData {
  score: number;
  recommendation: string;
  jobTitle: string;
  companyName: string;
  locationText: string | null;
  remoteStatus: string | null;
  sourcePublished: string | null;
  firstSeen: string;
  strengths: string[];
  gaps: string[];
  jobUrl: string | null;
  applyUrl: string | null;
  supabaseUrl: string;
}

function buildEmailHtml(data: EmailData): string {
  const locationLine = [data.locationText, data.remoteStatus].filter(Boolean).join(' · ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Inter', Arial, sans-serif; background: #0a0c10; color: #c9d1d9; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #0e1117; border: 1px solid #1a1f2b; border-radius: 8px; overflow: hidden; }
    .header { padding: 16px 24px; border-bottom: 1px solid #1a1f2b; }
    .header h1 { margin: 0; font-size: 14px; color: #22d3ee; letter-spacing: 2px; }
    .section { padding: 16px 24px; border-bottom: 1px solid #1a1f2b; }
    .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .value { font-size: 14px; color: #e2e8f0; }
    .score { font-size: 32px; font-weight: bold; font-family: monospace; color: ${data.score >= 90 ? '#34d399' : data.score >= 82 ? '#22d3ee' : '#fbbf24'}; }
    .bullet { font-size: 13px; color: #c9d1d9; margin: 4px 0; }
    .bullet strong { color: #e2e8f0; }
    .btn { display: inline-block; padding: 8px 16px; background: #222836; border: 1px solid #3a4256; border-radius: 4px; color: #e2e8f0; text-decoration: none; font-size: 13px; margin-right: 8px; }
    .footer { padding: 12px 24px; font-size: 11px; color: #475569; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>JOB RADAR · NEW JOB DETECTED</h1>
    </div>
    <div class="section">
      <div class="label">Role</div>
      <div class="value"><strong>${data.jobTitle}</strong></div>
      <div class="label" style="margin-top:8px">Company</div>
      <div class="value">${data.companyName}</div>
      <div class="label" style="margin-top:8px">Location</div>
      <div class="value">${locationLine || 'N/A'}</div>
    </div>
    <div class="section">
      <div style="display:flex; align-items:center; gap:16px;">
        <div class="score">${data.score}</div>
        <div>
          <div class="label">Fit Score / 100</div>
          <div class="value">${data.recommendation}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="label">Published</div>
      <div class="value">${data.sourcePublished ?? 'N/A'}</div>
      <div class="label" style="margin-top:8px">First seen</div>
      <div class="value">${data.firstSeen}</div>
    </div>
    <div class="section">
      <div class="label">Why It Fits</div>
      ${data.strengths.map((s) => `<div class="bullet">+ ${s}</div>`).join('')}
    </div>
    <div class="section">
      <div class="label">Watch Out</div>
      ${data.gaps.map((g) => `<div class="bullet">! ${g}</div>`).join('')}
    </div>
    <div class="section">
      ${data.jobUrl ? `<a href="${data.jobUrl}" class="btn">View Job Radar</a>` : ''}
      ${data.applyUrl ? `<a href="${data.applyUrl}" class="btn">Open Application</a>` : ''}
    </div>
    <div class="footer">
      Job Radar — Private operations dashboard. This alert was generated automatically. Human review is required before any application is submitted.
    </div>
  </div>
</body>
</html>`;
}
