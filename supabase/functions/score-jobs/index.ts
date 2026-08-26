// Job Radar — AI Scoring Edge Function (v3.2: deterministic scoring + enrichment + auth)
// Scores unscored jobs against Richard's candidate profile using a structured
// 0-100 rubric. Runs a deterministic prefilter first, then calls the AI model
// only for relevant jobs. The model returns components + penalties only;
// the SERVER calculates total_score and recommendation deterministically.
// For jobs passing prefilter with no description, fetches full posting detail
// from the ATS before scoring.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// ---- Prefilter (inlined, no shared code between edge functions) ----

const LA_AREA_CITIES = [
  'los angeles', 'hollywood', 'west hollywood', 'burbank', 'glendale',
  'culver city', 'santa monica', 'venice', 'studio city', 'universal city',
  'inglewood', 'el segundo', 'beverly hills', 'century city', 'pasadena',
  'sherman oaks', 'north hollywood', 'playa vista', 'marina del rey',
];

const REMOTE_PATTERNS = [
  'remote - us', 'remote us', 'remote, us', 'remote, united states',
  'united states - remote', 'usa - remote', 'us remote',
  'remote - us & canada', 'california remote', 'remote',
];

const REJECT_CITIES = [
  'new york', 'san francisco', 'seattle', 'austin', 'chicago', 'boston',
  'washington dc', 'washington, dc', 'nashville', 'denver', 'portland',
  'atlanta', 'miami', 'dallas', 'houston', 'philadelphia', 'phoenix',
  'minneapolis', 'detroit', 'jersey city', 'new jersey',
];

const NON_US_INDICATORS = [
  'london', 'toronto', 'vancouver', 'berlin', 'paris', 'tokyo', 'singapore',
  'sydney', 'dublin', 'amsterdam', 'mexico', 'belgium', 'germany', 'france',
  'spain', 'italy', 'netherlands', 'sweden', 'norway', 'denmark', 'finland',
  'poland', 'india', 'japan', 'china', 'south korea', 'brazil', 'argentina',
  'south africa', 'israel', 'united arab emirates', 'saudi arabia',
  'united kingdom', 'england', 'scotland', 'ireland', 'switzerland',
  'austria', 'portugal', 'czech', 'romania', 'hungary', 'greece', 'turkey',
  'egypt', 'nigeria', 'kenya', 'morocco',
];

function evaluateGeography(locationText: string | null): { state: 'PASS' | 'FAIL' | 'UNKNOWN'; reason: string } {
  if (!locationText || locationText.trim() === '') {
    return { state: 'UNKNOWN', reason: 'Location absent — deferring to role gate' };
  }
  const lower = locationText.toLowerCase();

  for (const city of LA_AREA_CITIES) {
    if (lower.includes(city)) return { state: 'PASS', reason: 'LA-area location: "' + city + '"' };
  }
  for (const pattern of REMOTE_PATTERNS) {
    if (lower.includes(pattern)) return { state: 'PASS', reason: 'Remote-US accepted: "' + pattern + '"' };
  }
  if (lower.includes('california') && lower.includes('remote')) {
    return { state: 'PASS', reason: 'California Remote accepted' };
  }
  for (const city of REJECT_CITIES) {
    if (lower.includes(city)) {
      if (lower.includes('remote') || LA_AREA_CITIES.some((c) => lower.includes(c))) {
        return { state: 'PASS', reason: 'Multi-location includes acceptable site' };
      }
      return { state: 'FAIL', reason: 'Location is non-LA/non-remote: "' + city + '"' };
    }
  }
  for (const indicator of NON_US_INDICATORS) {
    if (lower.includes(indicator)) {
      if (lower.includes('remote') || LA_AREA_CITIES.some((c) => lower.includes(c))) {
        return { state: 'PASS', reason: 'Multi-location includes acceptable site' };
      }
      return { state: 'FAIL', reason: 'Non-US location: "' + indicator + '"' };
    }
  }
  if (
    (lower.includes('canada') && !lower.includes('remote')) ||
    lower.includes('europe') || lower.includes('asia') || lower.includes('australia') ||
    lower.includes('south america')
  ) {
    if (!lower.includes('remote') && !LA_AREA_CITIES.some((c) => lower.includes(c))) {
      return { state: 'FAIL', reason: 'Non-US region' };
    }
  }
  return { state: 'UNKNOWN', reason: 'Location ambiguous — deferring to role gate' };
}

const STRONG_CONCEPTS = [
  'production operations', 'production management', 'production manager',
  'line producer', 'content operations', 'studio operations', 'creative operations',
  'media operations', 'production technology', 'production systems',
  'content systems', 'production finance systems', 'post-production operations',
  'workflow operations', 'workflow automation', 'operational transformation',
  'ai operations', 'ai transformation', 'ai workflow', 'agentic workflow',
  'creative technology', 'creator operations', 'digital media operations',
  'content production', 'original content production', 'process improvement',
  'cross-functional operations', 'business systems',
];

const DOMAIN_WORDS = ['media', 'content', 'creative', 'production', 'entertainment', 'studio'];

const CONDITIONAL_CONCEPTS = [
  'program management', 'project management', 'release management',
  'technical program management', 'operations manager',
];

const GENERIC_WORDS = ['content', 'media', 'studio', 'production', 'ai', 'operations', 'program', 'project', 'technology'];

const SENIORITY_POSITIVES = [
  'director', 'head of', 'vice president', ' vp ', ' vp,', 'vp of',
  'senior manager', 'sr manager', 'lead', 'program manager',
  'operations manager', 'production manager', 'line producer', 'executive producer',
];

const DISCIPLINE_EXCLUSIONS = [
  'software engineer', 'backend engineer', 'front-end engineer', 'frontend engineer',
  'full-stack engineer', 'fullstack engineer', 'ml engineer', 'machine learning engineer',
  'research scientist', 'data scientist', 'devops', 'sre', 'site reliability',
  'network engineer', 'security engineer', 'account executive', 'quota-carrying',
  'quota carrying', 'sales role', 'commission', 'recruiter', 'talent acquisition',
  'hr specialist', 'human resources specialist', 'accountant', ' tax ',
  'controller', 'attorney', 'legal counsel', 'general counsel', 'nurse', 'physician',
  'sales development', 'sales engineer', 'solutions architect',
  'customer success', 'support specialist', 'helpdesk', 'help desk',
  'infrastructure', 'cybersecurity', 'fellowship',
  'reporter', 'editor', 'designer', 'graphic',
  'marketing manager', 'marketing specialist', 'social media',
  'lifecycle marketing', 'growth marketing', 'product marketing',
  'compensation', 'talent relations', 'talent manager',
  'lead generation',
];

const JUNIOR_PENALTY_WORDS = [
  'intern', 'internship', 'coordinator', 'assistant', 'junior', 'jr.', 'jr ', 'entry level', 'entry-level',
];

interface PrefilterResult {
  relevant: boolean;
  geography: 'PASS' | 'FAIL' | 'UNKNOWN';
  roleStrength: 'STRONG' | 'MODERATE' | 'WEAK';
  positiveHits: string[];
  negativeHits: string[];
  juniorPenalty: boolean;
  reason: string;
}

function prefilterJob(title: string, locationText: string | null, description: string | null): PrefilterResult {
  const text = title + '\n' + (description ?? '');
  const lower = text.toLowerCase();

  const geo = evaluateGeography(locationText);

  const positiveHits: string[] = [];
  let strongCount = 0;

  for (const concept of STRONG_CONCEPTS) {
    if (lower.includes(concept)) { positiveHits.push(concept); strongCount++; }
  }

  let conditionalCount = 0;
  const hasDomain = DOMAIN_WORDS.some((d) => lower.includes(d));
  for (const concept of CONDITIONAL_CONCEPTS) {
    if (lower.includes(concept) && hasDomain) { positiveHits.push(concept); conditionalCount++; }
  }

  const titleLower = title.toLowerCase();
  const hasSeniorityPositive = SENIORITY_POSITIVES.some((s) => titleLower.includes(s));

  const negativeHits: string[] = [];
  let hasStrongExclusion = false;
  for (const concept of DISCIPLINE_EXCLUSIONS) {
    if (lower.includes(concept)) { negativeHits.push(concept); hasStrongExclusion = true; }
  }

  const juniorPenalty = JUNIOR_PENALTY_WORDS.some((w) => titleLower.includes(w));

  let roleStrength: 'STRONG' | 'MODERATE' | 'WEAK' = 'WEAK';
  if (strongCount >= 1 || conditionalCount >= 1) {
    roleStrength = strongCount >= 2 ? 'STRONG' : 'MODERATE';
  } else if (hasSeniorityPositive && hasDomain) {
    roleStrength = 'MODERATE';
  }

  const reasons: string[] = [];

  if (geo.state === 'FAIL') {
    reasons.push('Geography FAIL: ' + geo.reason);
    return { relevant: false, geography: geo.state, roleStrength, positiveHits, negativeHits, juniorPenalty, reason: reasons.join('; ') };
  }
  if (hasStrongExclusion) {
    reasons.push('Discipline exclusion: ' + negativeHits.join(', '));
    if (geo.state !== 'UNKNOWN') reasons.push('Geography: ' + geo.state);
    return { relevant: false, geography: geo.state, roleStrength, positiveHits, negativeHits, juniorPenalty, reason: reasons.join('; ') };
  }
  if (juniorPenalty && roleStrength === 'WEAK') {
    reasons.push('Junior/coordinator/assistant title with no strong role match');
    if (geo.state !== 'UNKNOWN') reasons.push('Geography: ' + geo.state);
    return { relevant: false, geography: geo.state, roleStrength, positiveHits, negativeHits, juniorPenalty, reason: reasons.join('; ') };
  }
  if (roleStrength === 'WEAK') {
    const hasOnlyGeneric = GENERIC_WORDS.some((g) => lower.includes(g));
    reasons.push(hasOnlyGeneric ? 'Generic keywords only — no strong role concept matched' : 'No relevant role concepts matched');
    if (geo.state !== 'UNKNOWN') reasons.push('Geography: ' + geo.state);
    return { relevant: false, geography: geo.state, roleStrength, positiveHits, negativeHits, juniorPenalty, reason: reasons.join('; ') };
  }

  reasons.push('Role: ' + roleStrength);
  reasons.push('Positive: ' + (positiveHits.join(', ') || 'none'));
  if (negativeHits.length > 0) reasons.push('Negative: ' + negativeHits.join(', '));
  reasons.push('Geography: ' + geo.state + (geo.reason ? ' (' + geo.reason + ')' : ''));
  if (juniorPenalty) reasons.push('Junior title — retained due to strong match');

  return { relevant: true, geography: geo.state, roleStrength, positiveHits, negativeHits, juniorPenalty, reason: reasons.join('; ') };
}

// ---- Scoring rubric and candidate profile (string constants, no template literals) ----

const CANDIDATE_PROFILE = [
  'CANDIDATE: Richard Kuhne',
  'LOCATION: Los Angeles, California',
  'POSITIONING: PRODUCTION OPERATIONS / AI SYSTEMS / WORKFLOW AUTOMATION',
  '',
  'Richard is an experienced production executive, line producer and production manager with extensive unscripted television, digital and branded-content experience, now combining that production-operating background with hands-on AI systems design, agentic workflows, workflow automation and independent digital-product development.',
  '',
  'PRODUCTION EXPERIENCE: production operations, line producing, production management, budgeting, cost tracking, scheduling, crew management, vendor management, production logistics, locations, travel, permits, insurance, payroll preparation, contracts, cross-department coordination, simultaneous productions, production problem solving, vendor negotiation, delivery coordination, legal/accounting/HR coordination.',
  '',
  'AI/SYSTEMS EXPERIENCE: agentic workflow design, AI-assisted development, structured skills and SOPs, API integrations, MCP integrations, human-in-the-loop systems, AI workflow architecture, multi-model workflows, AI-assisted research, operational decision support, source-backed reasoning, information normalization, exception detection.',
  '',
  'MEDIA/PRODUCT EXPERIENCE: unscripted television, digital content, branded content, AI-assisted production, research systems, digital publishing, audience development, emerging media.',
  '',
  'PROOF PROJECTS: FIELDPLAN (agentic production-operations prototype), PDUFA PULSE (AI-assisted biotech intelligence publication), THE PICKUP (entertainment intelligence product).',
  '',
  'PREVIOUS: NBCUniversal Digital Lab (Line Producer, Staff Production Manager), freelance across HGTV, TLC, PBS, Discovery.',
  '',
  'TARGET ROLE FAMILIES: AI+Production/Media Operations, Production/Content Operations, Media/Creative Technology, Product/Program/Operations.',
  '',
  'NEVER DESCRIBE RICHARD AS: software engineer, ML engineer, data scientist, computer scientist, full-stack engineer, enterprise salesperson, quota-carrying salesperson, attorney, CPA, HR specialist. NEVER FABRICATE QUALIFICATIONS.',
].join('\n');

const SCORING_RUBRIC = [
  'SCORING RUBRIC (0-100 total):',
  '- PRODUCTION/OPERATIONS MATCH: 0-25',
  '- AI/WORKFLOW TRANSFORMATION MATCH: 0-20',
  '- MEDIA/ENTERTAINMENT DOMAIN MATCH: 0-15',
  '- LEADERSHIP/CROSS-FUNCTIONAL MATCH: 0-15',
  '- EXPERIENCE TRANSFERABILITY: 0-10',
  '- SENIORITY MATCH: 0-10',
  '- LOCATION/WORK ARRANGEMENT: 0-5',
  '',
  'PENALTIES (subtract from total):',
  '- Software-engineering requirement: -20 to -35',
  '- ML research/engineering: -25 to -40',
  '- Mandatory specialized CS background: -15 to -30',
  '- Quota-carrying enterprise sales: -20 to -35',
  '- Accounting-specialist: -20',
  '- HR/recruiting specialist: -20',
  '- Entry-level: -20 to -35',
  '- VFX/animation pipeline engineering: -15 to -25 (distinct from production operations)',
  '- QA/testing as primary discipline: -15 to -25 (distinct from production operations)',
  '- Creative craft direction (art/design) as primary discipline: -10 to -20',
  '- Seasonal/temporary roles: -5 to -10',
  '',
  'CALIBRATION RULES:',
  '- Distinguish underlying professional discipline from surface keyword overlap.',
  '- Penalize technical disciplines requiring substantial engineering/VFX pipeline expertise the candidate does not possess.',
  '- Penalize QA/testing disciplines unrelated to production operations.',
  '- Penalize creative-direction roles whose primary requirement is creative craft rather than operations management.',
  '- Penalize junior/assistant/seasonal roles heavily.',
  '- Do NOT penalize a strange title merely because it is unfamiliar if the actual responsibilities strongly match production operations, workflow transformation, cross-functional program management, or AI-enabled media operations.',
  '- Location is secondary and should carry modest weight (0-5) once the geography gate has already passed. Do not double-penalize location.',
  '- NEVER fabricate candidate experience. Only reference skills and experience listed in the candidate profile. If a job requires experience the candidate does not have, name it as a gap.',
].join('\n');

const SYSTEM_PROMPT_TEMPLATE = [
  'You are an expert career analyst evaluating job postings for fit against a specific candidate.',
  SCORING_RUBRIC,
  '',
  CANDIDATE_PROFILE,
  '',
  'Respond with ONLY a JSON object in this exact shape:',
  '{',
  '  "confidence": "HIGH" | "MEDIUM" | "LOW",',
  '  "components": {',
  '    "production_operations": 0-25,',
  '    "ai_workflow": 0-20,',
  '    "media_domain": 0-15,',
  '    "leadership": 0-15,',
  '    "transferability": 0-10,',
  '    "seniority": 0-10,',
  '    "location": 0-5',
  '  },',
  '  "penalties": [',
  '    { "reason": "string", "points": negative-integer }',
  '  ],',
  '  "why_this_fits": ["string"],',
  '  "strongest_resume_evidence": ["string"],',
  '  "gaps": ["string"],',
  '  "hiring_manager_thesis": "string"',
  '}',
  '',
  'Do NOT include "score" or "recommendation" in your response. The server will calculate total_score and recommendation deterministically from your components and penalties. The total is the sum of all component values plus all penalty points (penalties are negative), clamped to 0-100. If no description text is available, set confidence to LOW.',
].join('\n');

// ---- Description enrichment for shortlisted jobs ----

async function enrichJobDescription(
  source: string,
  sourceJobId: string,
  atsIdentifier: string | null,
  jobUrl: string | null
): Promise<{ description_text: string | null; description_html: string | null }> {
  try {
    if (source === 'greenhouse' && atsIdentifier) {
      const url = 'https://boards-api.greenhouse.io/v1/boards/' + atsIdentifier + '/jobs/' + sourceJobId;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) return { description_text: null, description_html: null };
      const data = await resp.json();
      const content = data.content ?? null;
      return {
        description_text: content ? stripHtml(content) : null,
        description_html: content ?? null,
      };
    }

    if (source === 'smartrecruiters' && atsIdentifier) {
      const url = 'https://api.smartrecruiters.com/v1/companies/' + atsIdentifier + '/postings/' + sourceJobId;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) return { description_text: null, description_html: null };
      const data = await resp.json();
      const jobAd = data.jobAd ?? null;
      if (jobAd) {
        const sections = jobAd.sections ?? {};
        const parts: string[] = [];
        for (const key of Object.keys(sections)) {
          const section = sections[key];
          if (section?.text) parts.push(section.text);
          else if (section?.title && section?.value) parts.push(section.title + ': ' + section.value);
        }
        const text = parts.join('\n\n') || null;
        return {
          description_text: text,
          description_html: jobAd.html ?? null,
        };
      }
      return { description_text: null, description_html: null };
    }

    if (source === 'talentbrew' && jobUrl) {
      const resp = await fetch(jobUrl, { headers: { Accept: 'text/html' } });
      if (!resp.ok) return { description_text: null, description_html: null };
      const html = await resp.text();
      // Every supported public source includes the full posting within main.
      // Preserve the canonical page HTML for snapshots; the scorer receives only text.
      const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]
        ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1]
        ?? html;
      const text = stripHtml(main);
      return {
        description_text: text.length > 80 ? text : null,
        description_html: main,
      };
    }

    // Lever and Ashby already return descriptions in the list endpoint
    return { description_text: null, description_html: null };
  } catch {
    return { description_text: null, description_html: null };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- Model provider abstraction (OpenAI implementation) ----

interface ModelProvider {
  complete(messages: Array<{ role: string; content: string }>, jsonMode: boolean): Promise<string>;
  readonly modelName: string;
}

function getModelProvider(): ModelProvider | null {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-5.6-luna';
  if (!apiKey) return null;

  return {
    modelName: model,
    async complete(messages, jsonMode) {
      const body: Record<string, unknown> = {
        model,
        messages,
        max_completion_tokens: 2000,
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

// ---- Response validation ----

interface PenaltyEntry {
  reason: string;
  points: number;
}

interface ScoreResponse {
  confidence: string;
  components: {
    production_operations: number;
    ai_workflow: number;
    media_domain: number;
    leadership: number;
    transferability: number;
    seniority: number;
    location: number;
  };
  penalties: PenaltyEntry[];
  why_this_fits: string[];
  strongest_resume_evidence: string[];
  gaps: string[];
  hiring_manager_thesis: string;
}

// ---- Deterministic score calculation (server-side, not model-controlled) ----

function calculateTotalScore(components: ScoreResponse['components'], penalties: PenaltyEntry[]): number {
  const componentSum =
    components.production_operations +
    components.ai_workflow +
    components.media_domain +
    components.leadership +
    components.transferability +
    components.seniority +
    components.location;
  const penaltyTotal = penalties.reduce((sum, p) => sum + p.points, 0);
  return clamp(componentSum + penaltyTotal, 0, 100);
}

function recommendationForScore(score: number): string {
  if (score >= 90) return 'EXCEPTIONAL';
  if (score >= 82) return 'APPLY_NOW';
  if (score >= 75) return 'STRONG_REVIEW';
  if (score >= 65) return 'WATCH';
  return 'IGNORE';
}

function validateScoreResponse(raw: unknown): ScoreResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const confidence = String(obj.confidence ?? '');
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(confidence)) return null;

  const comp = obj.components as Record<string, unknown> | undefined;
  if (!comp || typeof comp !== 'object') return null;

  const components = {
    production_operations: clamp(Number(comp.production_operations ?? 0), 0, 25),
    ai_workflow: clamp(Number(comp.ai_workflow ?? 0), 0, 20),
    media_domain: clamp(Number(comp.media_domain ?? 0), 0, 15),
    leadership: clamp(Number(comp.leadership ?? 0), 0, 15),
    transferability: clamp(Number(comp.transferability ?? 0), 0, 10),
    seniority: clamp(Number(comp.seniority ?? 0), 0, 10),
    location: clamp(Number(comp.location ?? 0), 0, 5),
  };

  const rawPenalties = obj.penalties;
  const penalties: PenaltyEntry[] = [];
  if (Array.isArray(rawPenalties)) {
    for (const p of rawPenalties) {
      if (typeof p === 'object' && p !== null) {
        const reason = String((p as Record<string, unknown>).reason ?? '');
        const points = Number((p as Record<string, unknown>).points ?? 0);
        if (reason && !isNaN(points) && points <= 0) {
          penalties.push({ reason, points });
        }
      }
    }
  }

  return {
    confidence,
    components,
    penalties,
    why_this_fits: Array.isArray(obj.why_this_fits) ? obj.why_this_fits.map(String) : [],
    strongest_resume_evidence: Array.isArray(obj.strongest_resume_evidence) ? obj.strongest_resume_evidence.map(String) : [],
    gaps: Array.isArray(obj.gaps) ? obj.gaps.map(String) : [],
    hiring_manager_thesis: String(obj.hiring_manager_thesis ?? ''),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// ---- Main handler ----

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

    const { data: jobs, error: jobsError } = await supabase
      .from('jobs')
      .select('*, companies(name, priority)')
      .eq('status', 'new')
      .order('first_seen_at', { ascending: false })
      .limit(200);

    if (jobsError || !jobs) {
      return new Response(
        JSON.stringify({ error: 'Failed to load jobs' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (jobs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No unscored jobs', scored: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let scored = 0;
    let skipped = 0;
    let errors = 0;
    const failures: Array<{ job: string; error: string }> = [];

    for (const job of jobs) {
      const prefilter = prefilterJob(job.title, job.location_text, job.description_text);
      if (!prefilter.relevant) {
        await supabase.from('jobs').update({ status: 'filtered' }).eq('id', job.id);
        skipped++;
        continue;
      }

      if (!provider) {
        await supabase.from('jobs').update({ status: 'prefiltered' }).eq('id', job.id);
        scored++;
        continue;
      }

      // Enrich description for jobs that passed prefilter but have no description
      let jobDescription = job.description_text;
      let enrichmentFailed = false;
      if ((!jobDescription || jobDescription.trim() === '') && job.source && job.source_job_id) {
        const { data: companyData } = await supabase
          .from('companies')
          .select('ats_type, ats_identifier')
          .eq('id', job.company_id)
          .single();

        if (companyData?.ats_identifier) {
          const enriched = await enrichJobDescription(
            job.source,
            job.source_job_id,
            companyData.ats_identifier,
            job.job_url,
          );
          if (enriched.description_text) {
            jobDescription = enriched.description_text;
            await supabase
              .from('jobs')
              .update({
                description_text: enriched.description_text,
                description_html: enriched.description_html,
              })
              .eq('id', job.id);
          } else {
            enrichmentFailed = true;
          }
        } else {
          enrichmentFailed = true;
        }
      }

      try {
        const userPrompt = [
          'Score this job posting for fit with the candidate:',
          '',
          'TITLE: ' + job.title,
          'COMPANY: ' + (job.companies?.name ?? 'Unknown'),
          'DEPARTMENT: ' + (job.department ?? 'N/A'),
          'LOCATION: ' + (job.location_text ?? 'N/A'),
          'REMOTE: ' + (job.remote_status ?? 'N/A'),
          'EMPLOYMENT TYPE: ' + (job.employment_type ?? 'N/A'),
          'DESCRIPTION:',
          (jobDescription ?? 'No description available.'),
        ].join('\n');

        const content = await provider.complete(
          [
            { role: 'system', content: SYSTEM_PROMPT_TEMPLATE },
            { role: 'user', content: userPrompt },
          ],
          true
        );

        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          failures.push({ job: job.title, error: 'Invalid JSON from model' });
          errors++;
          continue;
        }

        const validated = validateScoreResponse(parsed);
        if (!validated) {
          failures.push({ job: job.title, error: 'Model response failed validation' });
          errors++;
          continue;
        }

        // Server-side deterministic score calculation
        const totalScore = calculateTotalScore(validated.components, validated.penalties);
        const recommendation = recommendationForScore(totalScore);

        // Force LOW confidence if no description was available
        const hasDescription = !!jobDescription && jobDescription.trim() !== '';
        const finalConfidence = (!hasDescription || enrichmentFailed)
          ? 'LOW'
          : validated.confidence;

        await supabase.from('job_scores').insert({
          job_id: job.id,
          total_score: totalScore,
          recommendation,
          confidence: finalConfidence,
          component_scores_json: validated.components,
          strengths_json: validated.why_this_fits,
          gaps_json: validated.gaps,
          penalties_json: validated.penalties,
          hiring_manager_thesis: validated.hiring_manager_thesis,
          strongest_resume_evidence_json: validated.strongest_resume_evidence,
          model_used: provider.modelName,
        });

        await supabase
          .from('jobs')
          .update({ status: 'scored' })
          .eq('id', job.id);

        scored++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failures.push({ job: job.title, error: errorMsg });
        errors++;
      }
    }

    return new Response(
      JSON.stringify({
        scored,
        skipped,
        errors,
        failures,
        totalProcessed: jobs.length,
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

