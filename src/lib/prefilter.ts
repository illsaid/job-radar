// Deterministic relevance + geography prefilter.
// Runs BEFORE expensive AI calls. Produces a structured decision with
// explicit reasons so operators can audit why a job passed or was filtered.

// ---- Geography gate ----

const LA_AREA_CITIES = [
  'los angeles',
  'hollywood',
  'west hollywood',
  'burbank',
  'glendale',
  'culver city',
  'santa monica',
  'venice',
  'studio city',
  'universal city',
  'inglewood',
  'el segundo',
  'beverly hills',
  'century city',
  'pasadena',
  'sherman oaks',
  'north hollywood',
  'playa vista',
  'marina del rey',
];

const REMOTE_PATTERNS = [
  'remote - us',
  'remote us',
  'remote, us',
  'remote, united states',
  'united states - remote',
  'usa - remote',
  'us remote',
  'remote - us & canada',
  'california remote',
  'remote',
];

const REJECT_CITIES = [
  'new york',
  'san francisco',
  'seattle',
  'austin',
  'chicago',
  'boston',
  'washington dc',
  'washington, dc',
  'nashville',
  'denver',
  'portland',
  'atlanta',
  'miami',
  'dallas',
  'houston',
  'philadelphia',
  'phoenix',
  'minneapolis',
  'detroit',
  'jersey city',
  'new jersey',
];

const NON_US_INDICATORS = [
  'london',
  'toronto',
  'vancouver',
  'berlin',
  'paris',
  'tokyo',
  'singapore',
  'sydney',
  'dublin',
  'amsterdam',
  'mexico',
  'belgium',
  'germany',
  'france',
  'spain',
  'italy',
  'netherlands',
  'sweden',
  'norway',
  'denmark',
  'finland',
  'poland',
  'india',
  'japan',
  'china',
  'south korea',
  'brazil',
  'argentina',
  'south africa',
  'israel',
  'united arab emirates',
  'saudi arabia',
  'united kingdom',
  'england',
  'scotland',
  'ireland',
  'switzerland',
  'austria',
  'portugal',
  'czech',
  'romania',
  'hungary',
  'greece',
  'turkey',
  'egypt',
  'nigeria',
  'kenya',
  'morocco',
];

export type GeoState = 'PASS' | 'FAIL' | 'UNKNOWN';

export function evaluateGeography(locationText: string | null): {
  state: GeoState;
  reason: string;
} {
  if (!locationText || locationText.trim() === '') {
    return { state: 'UNKNOWN', reason: 'Location absent — deferring to role gate' };
  }

  const lower = locationText.toLowerCase();

  // Check LA-area cities first
  for (const city of LA_AREA_CITIES) {
    if (lower.includes(city)) {
      return { state: 'PASS', reason: `LA-area location: "${city}"` };
    }
  }

  // Check remote patterns
  for (const pattern of REMOTE_PATTERNS) {
    if (lower.includes(pattern)) {
      return { state: 'PASS', reason: `Remote-US accepted: "${pattern}"` };
    }
  }

  // California + Remote is acceptable
  if (lower.includes('california') && lower.includes('remote')) {
    return { state: 'PASS', reason: 'California Remote accepted' };
  }

  // Check if location is clearly a reject city (US non-LA)
  for (const city of REJECT_CITIES) {
    if (lower.includes(city)) {
      // But if it also mentions remote or LA, allow (multi-location)
      if (lower.includes('remote') || LA_AREA_CITIES.some((c) => lower.includes(c))) {
        return { state: 'PASS', reason: 'Multi-location includes acceptable site' };
      }
      return { state: 'FAIL', reason: `Location is non-LA/non-remote: "${city}"` };
    }
  }

  // Check non-US indicators
  for (const indicator of NON_US_INDICATORS) {
    if (lower.includes(indicator)) {
      // Allow if remote or LA is also mentioned
      if (lower.includes('remote') || LA_AREA_CITIES.some((c) => lower.includes(c))) {
        return { state: 'PASS', reason: 'Multi-location includes acceptable site' };
      }
      return { state: 'FAIL', reason: `Non-US location: "${indicator}"` };
    }
  }

  // Non-US locations
  if (
    lower.includes('canada') && !lower.includes('remote') ||
    lower.includes('europe') ||
    lower.includes('asia') ||
    lower.includes('australia') ||
    lower.includes('south america')
  ) {
    if (!lower.includes('remote') && !LA_AREA_CITIES.some((c) => lower.includes(c))) {
      return { state: 'FAIL', reason: 'Non-US region' };
    }
  }

  // Ambiguous — allow role gate to evaluate
  return { state: 'UNKNOWN', reason: 'Location ambiguous — deferring to role gate' };
}

// ---- Role relevance gate ----

// Strong multi-word concepts that indicate a real match
const STRONG_CONCEPTS = [
  'production operations',
  'production management',
  'production manager',
  'line producer',
  'content operations',
  'studio operations',
  'creative operations',
  'media operations',
  'production technology',
  'production systems',
  'content systems',
  'production finance systems',
  'post-production operations',
  'workflow operations',
  'workflow automation',
  'operational transformation',
  'ai operations',
  'ai transformation',
  'ai workflow',
  'agentic workflow',
  'creative technology',
  'creator operations',
  'digital media operations',
  'content production',
  'original content production',
  'process improvement',
  'cross-functional operations',
  'business systems',
];

// Concepts that are positive only when combined with a domain word
const DOMAIN_WORDS = [
  'media',
  'content',
  'creative',
  'production',
  'entertainment',
  'studio',
];

const CONDITIONAL_CONCEPTS = [
  'program management',
  'project management',
  'release management',
  'technical program management',
  'operations manager',
];

// Generic words that NEVER qualify a job by themselves
const GENERIC_WORDS = [
  'content',
  'media',
  'studio',
  'production',
  'ai',
  'operations',
  'program',
  'project',
  'technology',
];

// Seniority positives
const SENIORITY_POSITIVES = [
  'director',
  'head of',
  'vice president',
  ' vp ',
  ' vp,',
  'vp of',
  'senior manager',
  'sr manager',
  'lead',
  'program manager',
  'operations manager',
  'production manager',
  'line producer',
  'executive producer',
];

// Strong discipline exclusions — these auto-filter
const DISCIPLINE_EXCLUSIONS = [
  'software engineer',
  'backend engineer',
  'front-end engineer',
  'frontend engineer',
  'full-stack engineer',
  'fullstack engineer',
  'ml engineer',
  'machine learning engineer',
  'research scientist',
  'data scientist',
  'devops',
  'sre',
  'site reliability',
  'network engineer',
  'security engineer',
  'account executive',
  'quota-carrying',
  'quota carrying',
  'sales role',
  'commission',
  'recruiter',
  'talent acquisition',
  'hr specialist',
  'human resources specialist',
  'accountant',
  ' tax ',
  'controller',
  'attorney',
  'legal counsel',
  'general counsel',
  'nurse',
  'physician',
  'sales development',
  'sales engineer',
  'solutions architect',
  'customer success',
  'support specialist',
  'helpdesk',
  'help desk',
  'infrastructure',
  'cybersecurity',
  'fellowship',
  'reporter',
  'editor',
  'designer',
  'graphic',
  'marketing manager',
  'marketing specialist',
  'social media',
  'lifecycle marketing',
  'growth marketing',
  'product marketing',
  'compensation',
  'talent relations',
  'talent manager',
  'lead generation',
];

// Junior/intern/coordinator/assistant — large seniority penalty
const JUNIOR_PENALTY_WORDS = [
  'intern',
  'internship',
  'coordinator',
  'assistant',
  'junior',
  'jr.',
  'jr ',
  'entry level',
  'entry-level',
];

export type RoleStrength = 'STRONG' | 'MODERATE' | 'WEAK';

export interface PrefilterResult {
  relevant: boolean;
  geography: GeoState;
  roleStrength: RoleStrength;
  positiveHits: string[];
  negativeHits: string[];
  juniorPenalty: boolean;
  reason: string;
}

export function prefilterJob(
  title: string,
  locationText: string | null,
  description: string | null,
): PrefilterResult {
  const text = `${title}\n${description ?? ''}`;
  const lower = text.toLowerCase();

  // ---- Geography gate ----
  const geo = evaluateGeography(locationText);

  // ---- Role relevance gate ----
  const positiveHits: string[] = [];
  let strongCount = 0;

  // Check strong concepts
  for (const concept of STRONG_CONCEPTS) {
    if (lower.includes(concept)) {
      positiveHits.push(concept);
      strongCount++;
    }
  }

  // Check conditional concepts (only count if a domain word is also present)
  let conditionalCount = 0;
  const hasDomain = DOMAIN_WORDS.some((d) => lower.includes(d));
  for (const concept of CONDITIONAL_CONCEPTS) {
    if (lower.includes(concept)) {
      if (hasDomain) {
        positiveHits.push(concept);
        conditionalCount++;
      }
    }
  }

  // Check seniority positives in title
  const titleLower = title.toLowerCase();
  const hasSeniorityPositive = SENIORITY_POSITIVES.some((s) => titleLower.includes(s));

  // Check discipline exclusions
  const negativeHits: string[] = [];
  let hasStrongExclusion = false;
  for (const concept of DISCIPLINE_EXCLUSIONS) {
    if (lower.includes(concept)) {
      negativeHits.push(concept);
      hasStrongExclusion = true;
    }
  }

  // Check junior penalty
  const juniorPenalty = JUNIOR_PENALTY_WORDS.some((w) => titleLower.includes(w));

  // ---- Determine role strength ----
  let roleStrength: RoleStrength = 'WEAK';

  if (strongCount >= 1 || conditionalCount >= 1) {
    roleStrength = strongCount >= 2 ? 'STRONG' : 'MODERATE';
  } else if (hasSeniorityPositive && hasDomain) {
    // Senior role in a relevant domain without an explicit strong concept
    roleStrength = 'MODERATE';
  }

  // ---- Determine relevance ----
  const reasons: string[] = [];

  // Geography FAIL filters immediately
  if (geo.state === 'FAIL') {
    reasons.push(`Geography FAIL: ${geo.reason}`);
    return {
      relevant: false,
      geography: geo.state,
      roleStrength,
      positiveHits,
      negativeHits,
      juniorPenalty,
      reason: reasons.join('; '),
    };
  }

  // Strong discipline exclusion filters immediately (even if geo passes)
  if (hasStrongExclusion) {
    reasons.push(`Discipline exclusion: ${negativeHits.join(', ')}`);
    if (geo.state !== 'UNKNOWN') reasons.push(`Geography: ${geo.state}`);
    return {
      relevant: false,
      geography: geo.state,
      roleStrength,
      positiveHits,
      negativeHits,
      juniorPenalty,
      reason: reasons.join('; '),
    };
  }

  // Junior penalty: normally filter unless there's a strong concept match
  if (juniorPenalty && roleStrength === 'WEAK') {
    reasons.push('Junior/coordinator/assistant title with no strong role match');
    if (geo.state !== 'UNKNOWN') reasons.push(`Geography: ${geo.state}`);
    return {
      relevant: false,
      geography: geo.state,
      roleStrength,
      positiveHits,
      negativeHits,
      juniorPenalty,
      reason: reasons.join('; '),
    };
  }

  // WEAK role with no positives and no seniority signal
  if (roleStrength === 'WEAK') {
    // Check if generic words are the ONLY thing present
    const hasOnlyGeneric = GENERIC_WORDS.some((g) => lower.includes(g));
    if (hasOnlyGeneric) {
      reasons.push('Generic keywords only — no strong role concept matched');
    } else {
      reasons.push('No relevant role concepts matched');
    }
    if (geo.state !== 'UNKNOWN') reasons.push(`Geography: ${geo.state}`);
    return {
      relevant: false,
      geography: geo.state,
      roleStrength,
      positiveHits,
      negativeHits,
      juniorPenalty,
      reason: reasons.join('; '),
    };
  }

  // Passed all gates
  reasons.push(`Role: ${roleStrength}`);
  reasons.push(`Positive: ${positiveHits.join(', ') || 'none'}`);
  if (negativeHits.length > 0) reasons.push(`Negative: ${negativeHits.join(', ')}`);
  reasons.push(`Geography: ${geo.state}${geo.reason ? ' (' + geo.reason + ')' : ''}`);
  if (juniorPenalty) reasons.push('Junior title — retained due to strong match');

  return {
    relevant: true,
    geography: geo.state,
    roleStrength,
    positiveHits,
    negativeHits,
    juniorPenalty,
    reason: reasons.join('; '),
  };
}

// Convenience wrapper for backward compatibility (takes a blob of text)
export function prefilterJobText(text: string): PrefilterResult {
  // Try to extract title and location from a text blob
  const lines = text.split('\n').filter((l) => l.trim());
  const title = lines[0] ?? text;
  const locationText = lines.find((l) =>
    LA_AREA_CITIES.some((c) => l.toLowerCase().includes(c)) ||
    REMOTE_PATTERNS.some((p) => l.toLowerCase().includes(p)) ||
    REJECT_CITIES.some((c) => l.toLowerCase().includes(c))
  ) ?? null;
  const description = lines.slice(1).join('\n');
  return prefilterJob(title, locationText, description);
}
