export interface SampleCompany {
  name: string;
  careers_url: string;
  ats_type: string;
  ats_identifier: string;
  priority: number;
  enabled: boolean;
  tags: string[];
  notes: string;
}

// Phase 2 watchlist — real candidate search universe.
// Test companies (Stripe, AngelList, Ashby, SmartRecruiters) are disabled in
// the database but retained for reference. This config reflects the enabled set.
export const SAMPLE_COMPANIES: SampleCompany[] = [
  // P1
  {
    name: 'Tubi',
    careers_url: 'https://job-boards.greenhouse.io/tubitv',
    ats_type: 'greenhouse',
    ats_identifier: 'tubitv',
    priority: 1,
    enabled: true,
    tags: ['entertainment', 'streaming', 'production', 'los-angeles'],
    notes: 'P1 — Greenhouse board tubitv',
  },
  {
    name: 'Wrapbook',
    careers_url: 'https://jobs.ashbyhq.com/wrapbook',
    ats_type: 'ashby',
    ats_identifier: 'wrapbook',
    priority: 1,
    enabled: true,
    tags: ['production-tech', 'ai', 'operations', 'remote'],
    notes: 'P1 — Ashby board wrapbook',
  },
  {
    name: 'NBCUniversal',
    careers_url: 'https://jobs.smartrecruiters.com/NBCUniversal3',
    ats_type: 'smartrecruiters',
    ats_identifier: 'NBCUniversal3',
    priority: 1,
    enabled: true,
    tags: ['entertainment', 'studio', 'production', 'los-angeles'],
    notes: 'P1 — SmartRecruiters board NBCUniversal3',
  },
  {
    name: 'Skydance',
    careers_url: 'https://jobs.lever.co/skydance',
    ats_type: 'lever',
    ats_identifier: 'skydance',
    priority: 1,
    enabled: true,
    tags: ['entertainment', 'studio', 'production', 'los-angeles'],
    notes: 'P1 — Lever board skydance',
  },
  {
    name: 'Whalar Group',
    careers_url: 'https://job-boards.greenhouse.io/whalarinc',
    ats_type: 'greenhouse',
    ats_identifier: 'whalarinc',
    priority: 1,
    enabled: true,
    tags: ['creator-economy', 'agency', 'production', 'operations', 'los-angeles'],
    notes: 'P1 — Greenhouse board whalarinc',
  },
  {
    name: 'A24',
    careers_url: 'https://job-boards.greenhouse.io/a24',
    ats_type: 'greenhouse',
    ats_identifier: 'a24',
    priority: 1,
    enabled: true,
    tags: ['entertainment', 'studio', 'production', 'los-angeles'],
    notes: 'P1 — Greenhouse board a24',
  },
  {
    name: 'ATTN',
    careers_url: 'https://job-boards.greenhouse.io/attn',
    ats_type: 'greenhouse',
    ats_identifier: 'attn',
    priority: 1,
    enabled: true,
    tags: ['digital-media', 'production', 'agency', 'los-angeles'],
    notes: 'P1 — Greenhouse board attn',
  },
  {
    name: 'Spotter',
    careers_url: 'https://job-boards.greenhouse.io/spotter',
    ats_type: 'greenhouse',
    ats_identifier: 'spotter',
    priority: 1,
    enabled: true,
    tags: ['creator-economy', 'digital-media', 'operations', 'los-angeles'],
    notes: 'P1 — Greenhouse board spotter',
  },
  {
    name: 'NFL',
    careers_url: 'https://job-boards.greenhouse.io/nflcareers',
    ats_type: 'greenhouse',
    ats_identifier: 'nflcareers',
    priority: 1,
    enabled: true,
    tags: ['sports-media', 'production', 'digital-media', 'los-angeles'],
    notes: 'P1 — Greenhouse board nflcareers',
  },
  {
    name: 'HeyGen',
    careers_url: 'https://job-boards.greenhouse.io/heygen',
    ats_type: 'greenhouse',
    ats_identifier: 'heygen',
    priority: 1,
    enabled: true,
    tags: ['creative-ai', 'video', 'workflow', 'los-angeles'],
    notes: 'P1 — Greenhouse board heygen',
  },
  {
    name: 'Runway',
    careers_url: 'https://jobs.ashbyhq.com/runway-ml',
    ats_type: 'ashby',
    ats_identifier: 'runway-ml',
    priority: 1,
    enabled: true,
    tags: ['creative-ai', 'video', 'media-technology'],
    notes: 'P1 — Ashby board runway-ml',
  },
  {
    name: 'ElevenLabs',
    careers_url: 'https://jobs.ashbyhq.com/elevenlabs',
    ats_type: 'ashby',
    ats_identifier: 'elevenlabs',
    priority: 1,
    enabled: true,
    tags: ['creative-ai', 'audio', 'media-technology'],
    notes: 'P1 — Ashby board elevenlabs',
  },
  // P2
  {
    name: 'BuzzFeed',
    careers_url: 'https://job-boards.greenhouse.io/buzzfeed',
    ats_type: 'greenhouse',
    ats_identifier: 'buzzfeed',
    priority: 2,
    enabled: true,
    tags: ['digital-media', 'studio', 'production', 'los-angeles'],
    notes: 'P2 — Greenhouse board buzzfeed',
  },
  {
    name: 'Forbes',
    careers_url: 'https://job-boards.greenhouse.io/forbes',
    ats_type: 'greenhouse',
    ats_identifier: 'forbes',
    priority: 2,
    enabled: true,
    tags: ['media', 'creator-economy', 'ai-operations'],
    notes: 'P2 — Greenhouse board forbes',
  },
  {
    name: 'Select Management Group',
    careers_url: 'https://job-boards.greenhouse.io/selectmanagementgroup',
    ats_type: 'greenhouse',
    ats_identifier: 'selectmanagementgroup',
    priority: 2,
    enabled: true,
    tags: ['creator-economy', 'talent', 'production', 'los-angeles'],
    notes: 'P2 — Greenhouse board selectmanagementgroup',
  },
];
