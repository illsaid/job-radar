// Job Radar — Application Packet Generator (v2.1: idempotent, versioned, deterministic verdict)
// Generates application packets for jobs scoring 75+.
// The verdict is copied deterministically from the stored score — the model does NOT decide it.
// Idempotent: one current packet per job. Updates when score or job materially changes.

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
    // Service role key — internal pipeline calls
    if (serviceRoleKey && token === serviceRoleKey) {
      return { ok: true, status: 200, message: '' };
    }
    // JWT validation
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

const CANDIDATE_PROFILE = [
  'CANDIDATE: Richard Kuhne — Los Angeles, California',
  'POSITIONING: PRODUCTION OPERATIONS / AI SYSTEMS / WORKFLOW AUTOMATION',
  '',
  'Experienced production executive, line producer, production manager. Unscripted TV, digital, branded content. Now combining production-operating background with AI systems design, agentic workflows, workflow automation, independent digital-product development.',
  '',
  'PROOF PROJECTS:',
  '- FIELDPLAN: agentic production-operations prototype (schedules, crew, documents, SOPs, exceptions, approval workflows, source-backed exception detection, human-in-the-loop decision gates)',
  '- PDUFA PULSE: AI-assisted biotech intelligence publication',
  '- THE PICKUP: entertainment intelligence product',
  '',
  'PREVIOUS: NBCUniversal Digital Lab (Line Producer, Staff Production Manager). Freelance across HGTV, TLC, PBS, Discovery.',
  '',
  'NEVER DESCRIBE AS: software engineer, ML engineer, data scientist, full-stack engineer, salesperson, attorney, CPA, HR specialist. NEVER FABRICATE QUALIFICATIONS.',
].join('\n');

interface ModelProvider {
  complete(messages: Array<{ role: string; content: string }>, jsonMode: boolean): Promise<string>;
  readonly modelName: string;
}

function getModelProvider(): ModelProvider | null {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('OPENAI_REVIEWER_MODEL') ?? Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o';
  if (!apiKey) return null;

  return {
    modelName: model,
    async complete(messages, jsonMode) {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: 0.4,
        max_tokens: 3000,
      };
      if (jsonMode) body.response_format = { type: 'json_object' };

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error('Model API error ' + resp.status + ': ' + errText);
      }

      const data = await resp.json();
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

// Deterministic verdict from score — model does NOT decide this
function verdictForScore(score: number): string {
  if (score >= 90) return 'EXCEPTIONAL';
  if (score >= 82) return 'APPLY_NOW';
  if (score >= 75) return 'STRONG_REVIEW';
  return 'PASS';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const provider = getModelProvider();
    if (!provider) {
      return new Response(
        JSON.stringify({ error: 'No model provider configured. Set OPENAI_API_KEY to enable packet generation.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find the LATEST score for each job that scores 75+
    const { data: scoredJobs, error } = await supabase
      .from('job_scores')
      .select('*, jobs(*, companies(name))')
      .gte('total_score', 75)
      .order('total_score', { ascending: false })
      .limit(20);

    if (error || !scoredJobs) {
      return new Response(
        JSON.stringify({ error: 'Failed to load scored jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deduplicate by job_id — keep highest score per job
    const jobMap = new Map<string, typeof scoredJobs[0]>();
    for (const row of scoredJobs) {
      const job = row.jobs as Record<string, unknown> | null;
      if (!job) continue;
      const jobId = job.id as string;
      if (!jobMap.has(jobId)) {
        jobMap.set(jobId, row);
      }
    }

    let packetsGenerated = 0;
    let packetsUpdated = 0;
    let packetsRemoved = 0;
    const failures: Array<{ job: string; error: string }> = [];

    // Also check for stale packets (score dropped below 75)
    const { data: allPackets } = await supabase
      .from('application_packets')
      .select('id, job_id, source_score_id, is_current')
      .eq('is_current', true);

    const scoredJobIds = new Set(jobMap.keys());
    if (allPackets) {
      for (const pkt of allPackets) {
        if (!scoredJobIds.has(pkt.job_id)) {
          // Job no longer scores 75+ — mark packet as non-current
          await supabase
            .from('application_packets')
            .update({ is_current: false })
            .eq('id', pkt.id);
          packetsRemoved++;
        }
      }
    }

    for (const [jobId, scoreRow] of jobMap) {
      const job = scoreRow.jobs as Record<string, unknown> | null;
      if (!job) continue;

      try {
        const jobTitle = job.title as string;
        const companyName = (job.companies as { name: string } | null)?.name ?? 'Unknown';
        const locationText = job.location_text as string | null;
        const compMin = job.compensation_min as number | null;
        const compMax = job.compensation_max as number | null;
        const compCurrency = job.compensation_currency as string;
        const description = job.description_text as string | null;
        const jobUrl = job.job_url as string | null;
        const applyUrl = job.apply_url as string | null;
        const sourcePublished = job.source_published_at as string | null;
        const firstSeen = job.first_seen_at as string;
        const sourceFingerprint = (job.source_fingerprint as string | null) ?? (job.content_hash as string);

        const strengths = scoreRow.strengths_json as string[];
        const gaps = scoreRow.gaps_json as string[];
        const penalties = scoreRow.penalties_json as Array<{ reason: string; points: number }> | string[];

        // Check for existing current packet
        const { data: existing } = await supabase
          .from('application_packets')
          .select('id, source_score_id, source_content_hash')
          .eq('job_id', jobId)
          .eq('is_current', true)
          .maybeSingle();

        // Skip if packet exists AND score hasn't changed AND job hasn't materially changed
        if (existing && existing.source_score_id === scoreRow.id && existing.source_content_hash === sourceFingerprint) {
          continue;
        }

        // Build the prompt
        const systemPrompt = [
          'You are an expert career strategist preparing a detailed application packet for a specific candidate. Do not merely summarize the posting — analyze deeply.',
          '',
          CANDIDATE_PROFILE,
          '',
          'Generate a JSON object with this exact shape:',
          '{',
          '  "second_stage_review": {',
          '    "what_they_need_solved": "string",',
          '    "why_richard_could_solve_it": "string",',
          '    "recruiter_hesitation": "string",',
          '    "hiring_manager_interest": "string",',
          '    "title_misleading": "string",',
          '    "experience_that_should_lead": "string",',
          '    "fieldplan_prominent": "yes/no with reason",',
          '    "nbcuniversal_prominent": "yes/no with reason",',
          '    "pdufa_pulse_relevant": "yes/no with reason",',
          '    "the_pickup_relevant": "yes/no with reason",',
          '    "speed_important": "yes/no with reason"',
          '  },',
          '  "what_they_actually_need": ["3-6 real operating problems as strings"],',
          '  "why_richard_fits": [',
          '    { "requirement": "string", "resume_evidence": "string", "strength_of_match": "DIRECT|TRANSFERABLE|GAP" }',
          '  ],',
          '  "gaps_and_risks": [',
          '    { "type": "true_experience_gap|terminology_mismatch|learnable_tool|screening_risk|unknown", "description": "string" }',
          '  ],',
          '  "resume_strategy": {',
          '    "emphasis": "PRODUCTION_OPERATIONS|AI_WORKFLOW_TRANSFORMATION|CREATIVE_MEDIA_OPERATIONS",',
          '    "suggested_changes": ["targeted truthful changes as strings"]',
          '  },',
          '  "application_note": "120-180 word note written in FIRST PERSON as Richard. Sound like an experienced operator writing to another professional. No third-person biography. No generic language. Lead with the specific operating problem and the strongest truthful connection. Acknowledge a material gap naturally when useful.",',
          '  "recruiter_message": "short direct first-person outreach, <=350 chars. Give the recipient a concrete reason to look at the application.",',
          '  "interview_thesis": ["3-5 points Richard should be ready to explain"],',
          '  "verdict_reason": "one sentence explaining why this verdict"',
          '}',
          '',
          'CRITICAL RULES:',
          '- Do NOT include a "final_verdict" field. The server sets the verdict deterministically from the stored score.',
          '- Every why_richard_fits item MUST classify strength_of_match as DIRECT, TRANSFERABLE, or GAP.',
          '- Never describe transferable evidence as direct experience.',
          '- Application note must be first person, 120-180 words, no "thrilled/excited/passionate" boilerplate.',
          '- Recruiter message must be first person, <=350 chars, no "unique blend" language.',
          '- Resume strategy must identify concrete existing evidence (NBCUniversal production-management, Fieldplan, specific workflow/SOP/exception/HITL work, budgeting/scheduling/vendor/cross-department experience). Never upgrade experience into something not established.',
        ].join('\n');

        const penaltiesText = Array.isArray(penalties)
          ? penalties.map((p) => {
              if (typeof p === 'string') return '- ' + p;
              return '- ' + p.reason + ' (' + p.points + ')';
            }).join('\n')
          : '';

        const userPrompt = [
          'Generate the application packet for this job:',
          '',
          'TITLE: ' + jobTitle,
          'COMPANY: ' + companyName,
          'LOCATION: ' + (locationText ?? 'N/A'),
          'SCORE: ' + scoreRow.total_score + '/100',
          'RECOMMENDATION: ' + scoreRow.recommendation,
          '',
          'STRENGTHS:',
          strengths.map((s) => '- ' + s).join('\n'),
          '',
          'GAPS:',
          gaps.map((g) => '- ' + g).join('\n'),
          '',
          'PENALTIES:',
          penaltiesText || 'None',
          '',
          'JOB DESCRIPTION:',
          description ?? 'No description available.',
        ].join('\n');

        const content = await provider.complete(
          [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          true
        );

        let packetJson: Record<string, unknown>;
        try {
          packetJson = JSON.parse(content);
        } catch {
          failures.push({ job: jobTitle, error: 'Invalid JSON from model' });
          continue;
        }

        // Deterministic verdict — server sets it, not the model
        const verdict = verdictForScore(scoreRow.total_score);
        packetJson.final_verdict = verdict;

        const markdown = buildPacketMarkdown(packetJson, {
          jobTitle,
          companyName,
          locationText,
          compMin,
          compMax,
          compCurrency,
          sourcePublished,
          firstSeen,
          score: scoreRow.total_score,
          recommendation: scoreRow.recommendation,
          jobUrl,
          applyUrl,
        });

        if (existing) {
          // Update existing packet
          await supabase
            .from('application_packets')
            .update({
              packet_json: packetJson,
              packet_markdown: markdown,
              source_content_hash: sourceFingerprint,
              source_score_id: scoreRow.id,
              model_used: provider.modelName,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          packetsUpdated++;
        } else {
          // Insert new packet
          await supabase.from('application_packets').insert({
            job_id: jobId,
            packet_json: packetJson,
            packet_markdown: markdown,
            source_content_hash: sourceFingerprint,
            source_score_id: scoreRow.id,
            model_used: provider.modelName,
            is_current: true,
          });
          packetsGenerated++;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const jobTitle = (job as { title: string }).title;
        failures.push({ job: jobTitle, error: errorMsg });
      }
    }

    return new Response(
      JSON.stringify({
        packetsGenerated,
        packetsUpdated,
        packetsRemoved,
        failures,
        totalProcessed: jobMap.size,
      }),
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

interface PacketMeta {
  jobTitle: string;
  companyName: string;
  locationText: string | null;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string;
  sourcePublished: string | null;
  firstSeen: string;
  score: number;
  recommendation: string;
  jobUrl: string | null;
  applyUrl: string | null;
}

function buildPacketMarkdown(packet: Record<string, unknown>, meta: PacketMeta): string {
  const lines: string[] = [];

  lines.push('# APPLICATION PACKET');
  lines.push('');
  lines.push('## SNAPSHOT');
  lines.push('- Company: ' + meta.companyName);
  lines.push('- Role: ' + meta.jobTitle);
  lines.push('- Location: ' + (meta.locationText ?? 'N/A'));
  if (meta.compMin) {
    const comp = meta.compCurrency + ' ' + meta.compMin.toLocaleString() + (meta.compMax ? '-' + meta.compMax.toLocaleString() : '');
    lines.push('- Compensation: ' + comp);
  }
  lines.push('- Published: ' + (meta.sourcePublished ?? 'N/A'));
  lines.push('- First seen: ' + meta.firstSeen);
  lines.push('- Fit score: ' + meta.score + '/100');
  lines.push('- Recommendation: ' + meta.recommendation);
  if (meta.jobUrl) lines.push('- Job URL: ' + meta.jobUrl);
  if (meta.applyUrl) lines.push('- Application URL: ' + meta.applyUrl);
  lines.push('');

  const review = packet.second_stage_review as Record<string, string> | undefined;
  if (review) {
    lines.push('## SECOND-STAGE REVIEW');
    lines.push('- What they need solved: ' + (review.what_they_need_solved ?? 'N/A'));
    lines.push('- Why Richard could solve it: ' + (review.why_richard_could_solve_it ?? 'N/A'));
    lines.push('- Recruiter hesitation: ' + (review.recruiter_hesitation ?? 'N/A'));
    lines.push('- Hiring manager interest: ' + (review.hiring_manager_interest ?? 'N/A'));
    lines.push('- Title misleading: ' + (review.title_misleading ?? 'N/A'));
    lines.push('- Experience that should lead: ' + (review.experience_that_should_lead ?? 'N/A'));
    lines.push('- Fieldplan prominent: ' + (review.fieldplan_prominent ?? 'N/A'));
    lines.push('- NBCUniversal prominent: ' + (review.nbcuniversal_prominent ?? 'N/A'));
    lines.push('- PDUFA Pulse relevant: ' + (review.pdufa_pulse_relevant ?? 'N/A'));
    lines.push('- The Pickup relevant: ' + (review.the_pickup_relevant ?? 'N/A'));
    lines.push('- Speed important: ' + (review.speed_important ?? 'N/A'));
    lines.push('');
  }

  const needs = packet.what_they_actually_need as string[] | undefined;
  if (needs) {
    lines.push('## WHAT THEY ACTUALLY NEED');
    needs.forEach((n) => lines.push('- ' + n));
    lines.push('');
  }

  const fits = packet.why_richard_fits as Array<{ requirement: string; resume_evidence: string; strength_of_match: string }> | undefined;
  if (fits) {
    lines.push('## WHY RICHARD FITS');
    fits.forEach((f) => {
      lines.push('- **' + f.requirement + '**');
      lines.push('  - Evidence: ' + f.resume_evidence);
      lines.push('  - Match: ' + f.strength_of_match);
    });
    lines.push('');
  }

  const gaps = packet.gaps_and_risks as Array<{ type: string; description: string }> | undefined;
  if (gaps) {
    lines.push('## GAPS / RISKS');
    gaps.forEach((g) => lines.push('- [' + g.type + '] ' + g.description));
    lines.push('');
  }

  const strategy = packet.resume_strategy as { emphasis: string; suggested_changes: string[] } | undefined;
  if (strategy) {
    lines.push('## RESUME STRATEGY');
    lines.push('Emphasis: ' + strategy.emphasis);
    strategy.suggested_changes?.forEach((s) => lines.push('- ' + s));
    lines.push('');
  }

  if (packet.application_note) {
    lines.push('## APPLICATION NOTE');
    lines.push(String(packet.application_note));
    lines.push('');
  }

  if (packet.recruiter_message) {
    lines.push('## RECRUITER MESSAGE');
    lines.push(String(packet.recruiter_message));
    lines.push('');
  }

  const thesis = packet.interview_thesis as string[] | undefined;
  if (thesis) {
    lines.push('## INTERVIEW THESIS');
    thesis.forEach((t) => lines.push('- ' + t));
    lines.push('');
  }

  lines.push('## FINAL VERDICT');
  lines.push('**' + (packet.final_verdict ?? 'N/A') + '** — ' + (packet.verdict_reason ?? ''));

  return lines.join('\n');
}

