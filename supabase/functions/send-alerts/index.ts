// Job Radar — Email Alert Edge Function (v2: new thresholds, cutoff, version-aware dedupe)
// Immediate alert: 82+ (APPLY_NOW or EXCEPTIONAL)
// No immediate alert: 75-81 (STRONG_REVIEW), 65-74 (WATCH), <65 (IGNORE)
// Packets still generate at 75+.
// Fails CLOSED: if alerts not explicitly enabled, sends zero emails.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// ---- Auth: service-role or authenticated user ----
async function authenticateRequest(
  req: Request,
  supabaseUrl: string,
  supabaseAnonKey: string
): Promise<{ ok: boolean; status: number; message: string }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (serviceRoleKey && token === serviceRoleKey) {
      return { ok: true, status: 200, message: '' };
    }
    if (token.split('.').length === 3) {
      const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: { user } } = await tempClient.auth.getUser(token);
      if (user) return { ok: true, status: 200, message: '' };
    }
  }

  return { ok: false, status: 401, message: 'Unauthorized' };
}

// ---- HTML escaping for untrusted content ----
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- URL validation: only allow http/https ----
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {
    // invalid URL
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const alertRecipient = Deno.env.get('ALERT_RECIPIENT');
  const alertFrom = Deno.env.get('ALERT_FROM');
  const alertsEnabled = Deno.env.get('ALERTS_ENABLED');
  const alertsActiveAfter = Deno.env.get('ALERTS_ACTIVE_AFTER');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase configuration' }),
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

  // Fail CLOSED: alerts must be explicitly enabled with all required config
  const isEnabled = alertsEnabled === 'true' || alertsEnabled === '1';
  if (!isEnabled || !resendApiKey || !alertRecipient || !alertFrom || !alertsActiveAfter) {
    return new Response(
      JSON.stringify({
        alertsSent: 0,
        disabled: true,
        reason: 'Alerts not enabled or missing configuration (ALERTS_ENABLED, RESEND_API_KEY, ALERT_RECIPIENT, ALERT_FROM, ALERTS_ACTIVE_AFTER)',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const cutoffTime = alertsActiveAfter;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Find latest score per job, 82+
    const { data: scoredJobs, error } = await supabase
      .from('job_scores')
      .select('*, jobs(*, companies(name, priority))')
      .gte('total_score', 82)
      .order('total_score', { ascending: false })
      .limit(50);

    if (error || !scoredJobs) {
      return new Response(
        JSON.stringify({ error: 'Failed to load scored jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplicate by job_id — keep highest score
    const jobMap = new Map<string, typeof scoredJobs[0]>();
    for (const row of scoredJobs) {
      const job = row.jobs as Record<string, unknown> | null;
      if (!job) continue;
      const jobId = job.id as string;
      if (!jobMap.has(jobId)) {
        jobMap.set(jobId, row);
      }
    }

    let alertsSent = 0;
    const failures: Array<{ job: string; error: string }> = [];

    for (const [jobId, scoreRow] of jobMap) {
      const job = scoreRow.jobs as Record<string, unknown> | null;
      if (!job) continue;

      const score = scoreRow.total_score as number;
      const firstSeenAt = job.first_seen_at as string;
      const lastMaterialChangeAt = job.last_material_change_at as string | null;
      const sourceFingerprint = (job.source_fingerprint as string | null) ?? (job.content_hash as string);

      // Cutoff check: only alert if job was first detected after cutoff OR materially changed after cutoff
      const firstSeenAfterCutoff = firstSeenAt > cutoffTime;
      const materialChangeAfterCutoff = !!lastMaterialChangeAt && lastMaterialChangeAt > cutoffTime;

      if (!firstSeenAfterCutoff && !materialChangeAfterCutoff) {
        continue; // Pre-activation job — no retrospective alert
      }

      // Determine alert type
      let alertType: string;
      if (score >= 90) {
        alertType = 'exceptional';
      } else if (score >= 82) {
        alertType = 'apply_now';
      } else {
        continue; // Below 82 — no immediate alert
      }

      // Version-aware dedupe: job_id + source_content_hash + alert_type
      const dedupeKey = jobId + ':' + (sourceFingerprint ?? '') + ':' + alertType;
      const { data: existingAlert } = await supabase
        .from('alerts')
        .select('id')
        .eq('job_id', jobId)
        .eq('alert_type', alertType)
        .eq('source_content_hash', sourceFingerprint ?? '')
        .maybeSingle();

      if (existingAlert) continue;

      // Build and send email
      const jobTitle = escapeHtml(job.title as string);
      const companyName = escapeHtml((job.companies as { name: string } | null)?.name ?? 'Unknown');
      const locationText = job.location_text as string | null;
      const remoteStatus = job.remote_status as string | null;
      const jobUrl = safeUrl(job.job_url as string | null);
      const applyUrl = safeUrl(job.apply_url as string | null);
      const sourcePublished = job.source_published_at as string | null;

      const strengths = (scoreRow.strengths_json as string[]).slice(0, 3);
      const gaps = (scoreRow.gaps_json as string[]).slice(0, 2);

      // Get packet thesis if available
      const { data: packet } = await supabase
        .from('application_packets')
        .select('packet_json')
        .eq('job_id', jobId)
        .eq('is_current', true)
        .maybeSingle();

      const packetJson = packet?.packet_json as Record<string, unknown> | null;
      const applicationThesis = packetJson?.application_note as string | null;
      const scoreThesis = scoreRow.hiring_manager_thesis as string | null;
      const thesisText = applicationThesis ?? scoreThesis ?? '';

      const subject = '[Job Radar] ' + score + ' — ' + (job.title as string) + ' — ' + ((job.companies as { name: string } | null)?.name ?? 'Unknown');

      const htmlBody = buildEmailHtml({
        score,
        recommendation: scoreRow.recommendation as string,
        jobTitle,
        companyName,
        locationText: escapeHtml(locationText ?? ''),
        remoteStatus: escapeHtml(remoteStatus ?? ''),
        sourcePublished: sourcePublished ?? null,
        firstSeen: firstSeenAt,
        lastMaterialChange: lastMaterialChangeAt,
        strengths: strengths.map(escapeHtml),
        gaps: gaps.map(escapeHtml),
        thesisText: escapeHtml(thesisText),
        jobUrl,
        applyUrl,
        dashboardUrl: 'https://radar.richardkuhne.com',
      });

      try {
        const resendResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + resendApiKey,
          },
          body: JSON.stringify({
            from: alertFrom,
            to: alertRecipient,
            subject,
            html: htmlBody,
          }),
        });

        if (!resendResponse.ok) {
          const errText = await resendResponse.text();
          failures.push({ job: job.title as string, error: 'Resend error: ' + errText });
          continue;
        }

        await supabase.from('alerts').insert({
          job_id: jobId,
          alert_type: alertType,
          recipient: alertRecipient,
          unique_key: dedupeKey,
          source_content_hash: sourceFingerprint ?? '',
        });

        alertsSent++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failures.push({ job: job.title as string, error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({ alertsSent, failures, totalProcessed: jobMap.size, disabled: false }),
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

interface EmailData {
  score: number;
  recommendation: string;
  jobTitle: string;
  companyName: string;
  locationText: string;
  remoteStatus: string;
  sourcePublished: string | null;
  firstSeen: string;
  lastMaterialChange: string | null;
  strengths: string[];
  gaps: string[];
  thesisText: string;
  jobUrl: string | null;
  applyUrl: string | null;
  dashboardUrl: string;
}

function buildEmailHtml(data: EmailData): string {
  const locationLine = [data.locationText, data.remoteStatus].filter(Boolean).join(' · ');
  const scoreColor = data.score >= 90 ? '#34d399' : '#22d3ee';

  return '<!DOCTYPE html>\n' +
'<html>\n' +
'<head>\n' +
'  <meta charset="utf-8">\n' +
'  <style>\n' +
'    body { font-family: Arial, sans-serif; background: #0a0c10; color: #c9d1d9; margin: 0; padding: 20px; }\n' +
'    .container { max-width: 600px; margin: 0 auto; background: #0e1117; border: 1px solid #1a1f2b; border-radius: 8px; overflow: hidden; }\n' +
'    .header { padding: 16px 24px; border-bottom: 1px solid #1a1f2b; }\n' +
'    .header h1 { margin: 0; font-size: 14px; color: #22d3ee; letter-spacing: 2px; }\n' +
'    .section { padding: 16px 24px; border-bottom: 1px solid #1a1f2b; }\n' +
'    .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }\n' +
'    .value { font-size: 14px; color: #e2e8f0; }\n' +
'    .score { font-size: 32px; font-weight: bold; font-family: monospace; color: ' + scoreColor + '; }\n' +
'    .bullet { font-size: 13px; color: #c9d1d9; margin: 4px 0; }\n' +
'    .btn { display: inline-block; padding: 8px 16px; background: #222836; border: 1px solid #3a4256; border-radius: 4px; color: #e2e8f0; text-decoration: none; font-size: 13px; margin-right: 8px; }\n' +
'    .footer { padding: 12px 24px; font-size: 11px; color: #475569; }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="container">\n' +
'    <div class="header"><h1>JOB RADAR &middot; ' + escapeHtml(data.recommendation) + '</h1></div>\n' +
'    <div class="section">\n' +
'      <div class="value"><strong>' + data.jobTitle + '</strong></div>\n' +
'      <div class="value" style="margin-top:4px">' + data.companyName + '</div>\n' +
'      <div class="value" style="margin-top:4px">' + (locationLine || 'N/A') + '</div>\n' +
'    </div>\n' +
'    <div class="section">\n' +
'      <div style="display:flex;align-items:center;gap:16px;">\n' +
'        <div class="score">' + data.score + '</div>\n' +
'        <div><div class="label">Fit Score / 100</div><div class="value">' + escapeHtml(data.recommendation) + '</div></div>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="section">\n' +
'      <div class="label">Published</div><div class="value">' + escapeHtml(data.sourcePublished ?? 'N/A') + '</div>\n' +
'      <div class="label" style="margin-top:8px">Job Radar detection</div><div class="value">' + escapeHtml(data.firstSeen) + '</div>\n' +
'    </div>\n' +
'    <div class="section">\n' +
'      <div class="label">Why It Matters</div>\n' +
'      <div class="bullet">' + data.thesisText + '</div>\n' +
'    </div>\n' +
'    <div class="section">\n' +
'      <div class="label">Top Fit</div>\n' +
      data.strengths.map(function(s) { return '<div class="bullet">+ ' + s + '</div>'; }).join('') + '\n' +
'    </div>\n' +
'    <div class="section">\n' +
'      <div class="label">Main Gap</div>\n' +
      data.gaps.map(function(g) { return '<div class="bullet">! ' + g + '</div>'; }).join('') + '\n' +
'    </div>\n' +
'    <div class="section">\n' +
      (data.dashboardUrl ? '<a href="' + escapeHtml(data.dashboardUrl) + '" class="btn">Job Radar Dashboard</a>' : '') +
      (data.jobUrl ? '<a href="' + escapeHtml(data.jobUrl) + '" class="btn">View Posting</a>' : '') +
      (data.applyUrl ? '<a href="' + escapeHtml(data.applyUrl) + '" class="btn">Open Application</a>' : '') +
'    </div>\n' +
'    <div class="footer">Job Radar &mdash; Private operations dashboard. Human review is required before any application is submitted.</div>\n' +
'  </div>\n' +
'</body>\n' +
'</html>';
}
