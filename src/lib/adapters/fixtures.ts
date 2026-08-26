import type { NormalizedJob } from './types';
import { computeContentHash } from './types';

// Test fixtures simulating real ATS API responses and expected normalization.
// These match the actual API response shapes verified against live endpoints.

// --- Greenhouse ---
// Real endpoint: https://boards-api.greenhouse.io/v1/boards/{board}/departments
// Jobs are nested inside departments: { departments: [{ id, name, jobs: [...] }] }
export const GREENHOUSE_FIXTURE = {
  departments: [
    {
      id: 1,
      name: 'Production Operations',
      jobs: [
        {
          id: 441001,
          title: 'Director, AI Production Operations',
          absolute_url: 'https://boards.greenhouse.io/testco/jobs/441001',
          location: { name: 'Los Angeles, CA / Hybrid' },
          updated_at: '2026-08-26T07:28:00Z',
          first_published: '2026-08-26T07:28:00Z',
          metadata: [{ name: 'Employment Type', value: 'Full-time' }],
        },
      ],
    },
    {
      id: 2,
      name: 'Engineering',
      jobs: [
        {
          id: 441002,
          title: 'Senior Software Engineer, Generative AI',
          absolute_url: 'https://boards.greenhouse.io/testco/jobs/441002',
          location: { name: 'Remote (US)' },
          updated_at: '2026-08-26T06:00:00Z',
          first_published: '2026-08-26T06:00:00Z',
          metadata: null,
        },
      ],
    },
  ],
};

// --- Lever ---
// Real endpoint: https://api.lever.co/v0/postings/{company}?mode=json
// Response is a flat JSON array, not { postings: [...] }
export const LEVER_FIXTURE: LeverPostingShape[] = [
  {
    id: 'lever-abc123',
    text: 'Director of Unscripted Production',
    descriptionPlain: 'Lead unscripted television production operations across multiple simultaneous series.',
    description: '<p>Lead unscripted television production operations.</p>',
    descriptionBody: null,
    descriptionBodyPlain: null,
    additional: null,
    additionalPlain: null,
    lists: null,
    categories: {
      team: 'Production',
      department: 'Content Operations',
      location: 'Los Angeles, CA',
      commitment: 'Full-time',
      level: 'Director',
    },
    country: 'United States',
    workplaceType: 'on-site',
    hostedUrl: 'https://jobs.lever.co/testco/lever-abc123',
    applyUrl: 'https://jobs.lever.co/testco/lever-abc123/apply',
    createdAt: 1756177680000,
    opening: null,
    openingPlain: null,
    compensation: { code: 'SALARY', min: 180000, max: 220000, currency: 'USD' },
  },
];

interface LeverPostingShape {
  id: string;
  text: string;
  descriptionPlain: string | null;
  description: string | null;
  descriptionBody: string | null;
  descriptionBodyPlain: string | null;
  additional: string | null;
  additionalPlain: string | null;
  lists: unknown[] | null;
  categories: {
    team: string | null;
    department: string | null;
    location: string | null;
    commitment: string | null;
    level: string | null;
  } | null;
  country: string | null;
  workplaceType: string | null;
  hostedUrl: string;
  applyUrl: string | null;
  createdAt: number;
  opening: string | null;
  openingPlain: string | null;
  compensation?: { code: string; min: number; max: number; currency: string } | null;
}

// --- Ashby ---
// Real endpoint: https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
// Response: { apiVersion, jobs: [...] }
export const ASHBY_FIXTURE = {
  apiVersion: '1',
  jobs: [
    {
      title: 'Creative Technology / AI Workflow Lead',
      location: 'Los Angeles, CA',
      department: 'Production',
      team: 'Creative Tech',
      isRemote: false,
      workplaceType: 'Hybrid',
      descriptionHtml: '<p>Drive AI-enabled creative workflow transformation.</p>',
      descriptionPlain: 'Drive AI-enabled creative workflow transformation.',
      publishedAt: '2026-08-26T07:00:00Z',
      employmentType: 'FullTime',
      jobUrl: 'https://jobs.ashbyhq.com/testco/ashby-xyz789',
      applyUrl: 'https://jobs.ashbyhq.com/testco/ashby-xyz789/apply',
      compensation: {
        summaryComponents: [
          { compensationType: 'Salary', minValue: 190000, maxValue: 240000, currencyCode: 'USD' },
        ],
      },
    },
  ],
};

// --- SmartRecruiters ---
// Real endpoint: https://api.smartrecruiters.com/v1/companies/{id}/postings
// Response: { content: [...] }
export const SMARTRECRUITERS_FIXTURE = {
  content: [
    {
      id: 'sr-job-001',
      uuid: 'f14d00ce-bfd2-4ebf-8a01-c8e0fa636a49',
      name: 'Production Coordinator',
      jobAdId: '6f7661db',
      defaultJobAd: true,
      refNumber: 'REF2010Z',
      company: { identifier: 'testco', name: 'Test Co' },
      department: { id: '5408693', label: 'Production' },
      function: { id: 'operations', label: 'Operations' },
      typeOfEmployment: { id: 'permanent', label: 'Full-time' },
      experienceLevel: { id: 'entry_level', label: 'Entry Level' },
      location: {
        city: 'Los Angeles',
        region: 'CA',
        country: 'us',
        remote: false,
        hybrid: false,
        fullLocation: 'Los Angeles, CA, United States',
      },
      releasedDate: '2026-08-25T10:00:00Z',
      ref: 'https://careers.smartrecruiters.com/testco/sr-job-001',
      industry: { id: 'media', label: 'Media' },
      customField: null,
    },
  ],
};

// Expected normalized results
export function expectedGreenhouseNormalized(): NormalizedJob[] {
  return [
    {
      source: 'greenhouse',
      source_job_id: '441001',
      title: 'Director, AI Production Operations',
      department: 'Production Operations',
      team: null,
      location_text: 'Los Angeles, CA / Hybrid',
      remote_status: 'Hybrid',
      employment_type: 'Full-time',
      compensation_min: null,
      compensation_max: null,
      compensation_currency: 'USD',
      description_text: null,
      description_html: null,
      job_url: 'https://boards.greenhouse.io/testco/jobs/441001',
      apply_url: 'https://boards.greenhouse.io/testco/jobs/441001',
      source_published_at: '2026-08-26T07:28:00Z',
      source_updated_at: '2026-08-26T07:28:00Z',
    },
    {
      source: 'greenhouse',
      source_job_id: '441002',
      title: 'Senior Software Engineer, Generative AI',
      department: 'Engineering',
      team: null,
      location_text: 'Remote (US)',
      remote_status: 'Remote',
      employment_type: null,
      compensation_min: null,
      compensation_max: null,
      compensation_currency: 'USD',
      description_text: null,
      description_html: null,
      job_url: 'https://boards.greenhouse.io/testco/jobs/441002',
      apply_url: 'https://boards.greenhouse.io/testco/jobs/441002',
      source_published_at: '2026-08-26T06:00:00Z',
      source_updated_at: '2026-08-26T06:00:00Z',
    },
  ];
}

// Duplicate detection test data
export const DUPLICATE_JOB_INPUT: NormalizedJob = {
  source: 'greenhouse',
  source_job_id: '441001',
  title: 'Director, AI Production Operations',
  department: 'Production Operations',
  team: null,
  location_text: 'Los Angeles, CA / Hybrid',
  remote_status: 'Hybrid',
  employment_type: 'Full-time',
  compensation_min: null,
  compensation_max: null,
  compensation_currency: 'USD',
  description_text: null,
  description_html: null,
  job_url: 'https://boards.greenhouse.io/testco/jobs/441001',
  apply_url: 'https://boards.greenhouse.io/testco/jobs/441001',
  source_published_at: '2026-08-26T07:28:00Z',
  source_updated_at: '2026-08-26T07:28:00Z',
};

export const CHANGED_JOB_INPUT: NormalizedJob = {
  ...DUPLICATE_JOB_INPUT,
  title: 'Senior Director, AI Production Operations',
};

export const DUPLICATE_HASH = computeContentHash(DUPLICATE_JOB_INPUT);
export const CHANGED_HASH = computeContentHash(CHANGED_JOB_INPUT);
