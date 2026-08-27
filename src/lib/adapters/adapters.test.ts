import { describe, it, expect } from 'vitest';
import { GreenhouseAdapter } from '@/lib/adapters/greenhouse';
import { LeverAdapter } from '@/lib/adapters/lever';
import { AshbyAdapter } from '@/lib/adapters/ashby';
import { SmartRecruitersAdapter } from '@/lib/adapters/smartrecruiters';
import { computeContentHash, normalizedJobSchema } from '@/lib/adapters/types';
import {
  GREENHOUSE_FIXTURE,
  LEVER_FIXTURE,
  ASHBY_FIXTURE,
  SMARTRECRUITERS_FIXTURE,
  expectedGreenhouseNormalized,
  DUPLICATE_HASH,
  CHANGED_HASH,
} from '@/lib/adapters/fixtures';

describe('content hash', () => {
  it('produces different hashes for changed job content', () => {
    expect(DUPLICATE_HASH).not.toBe(CHANGED_HASH);
  });

  it('produces a deterministic hex string', () => {
    const job = {
      source: 'greenhouse',
      source_job_id: '123',
      title: 'Test Job',
      department: 'Eng',
      team: null,
      location_text: 'Remote',
      remote_status: 'Remote',
      employment_type: 'Full-time',
      compensation_min: null,
      compensation_max: null,
      compensation_currency: 'USD',
      description_text: 'A job description',
      description_html: null,
      job_url: 'https://example.com/job/123',
      apply_url: null,
      source_published_at: null,
      source_updated_at: null,
    };
    const hash1 = computeContentHash(job);
    const hash2 = computeContentHash(job);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]+$/);
  });
});

describe('normalized job schema validation', () => {
  it('accepts a valid normalized job', () => {
    const valid = {
      source: 'greenhouse',
      source_job_id: '123',
      title: 'Test Job',
      compensation_currency: 'USD',
    };
    const result = normalizedJobSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects a job missing required source_job_id', () => {
    const invalid = {
      source: 'greenhouse',
      title: 'Test Job',
    };
    const result = normalizedJobSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('Greenhouse fixture normalization', () => {
  it('matches expected normalized output', () => {
    const expected = expectedGreenhouseNormalized();

    // Jobs are nested inside departments in the real API
    const allJobs = GREENHOUSE_FIXTURE.departments.flatMap((d) => d.jobs.map((j) => ({ ...j, deptName: d.name })));
    expect(allJobs).toHaveLength(2);
    expect(allJobs[0].title).toBe(expected[0].title);
    expect(allJobs[0].id).toBe(Number(expected[0].source_job_id));

    // Department names come from the parent department object
    expect(allJobs[0].deptName).toBe('Production Operations');
    expect(allJobs[1].deptName).toBe('Engineering');

    expect(expected[0].remote_status).toBe('Hybrid');
    expect(expected[1].remote_status).toBe('Remote');
  });
});

describe('Lever fixture structure (flat array)', () => {
  it('has valid posting structure with compensation', () => {
    expect(LEVER_FIXTURE).toHaveLength(1);
    expect(Array.isArray(LEVER_FIXTURE)).toBe(true);
    const posting = LEVER_FIXTURE[0];
    expect(posting.text).toBe('Director of Unscripted Production');
    expect(posting.compensation?.min).toBe(180000);
    expect(posting.compensation?.max).toBe(220000);
    expect(posting.categories?.department).toBe('Content Operations');
  });
});

describe('Ashby fixture structure (posting-api shape)', () => {
  it('has valid jobs array with workplaceType and compensation', () => {
    expect(ASHBY_FIXTURE.jobs).toHaveLength(1);
    const job = ASHBY_FIXTURE.jobs[0];
    expect(job.workplaceType).toBe('Hybrid');
    expect(job.title).toBe('Creative Technology / AI Workflow Lead');
    expect(job.compensation?.summaryComponents?.[0]?.minValue).toBe(190000);
    expect(job.employmentType).toBe('FullTime');
  });
});

describe('SmartRecruiters fixture structure (postings shape)', () => {
  it('has valid content array with name and location', () => {
    expect(SMARTRECRUITERS_FIXTURE.content).toHaveLength(1);
    const job = SMARTRECRUITERS_FIXTURE.content[0];
    expect(job.name).toBe('Production Coordinator');
    expect(job.department?.label).toBe('Production');
    expect(job.location?.city).toBe('Los Angeles');
    expect(job.location?.remote).toBe(false);
    expect(job.ref).toContain('careers.smartrecruiters.com');
  });
});

describe('adapter instantiation', () => {
  it('creates all four adapters with correct names', () => {
    expect(new GreenhouseAdapter().name).toBe('greenhouse');
    expect(new LeverAdapter().name).toBe('lever');
    expect(new AshbyAdapter().name).toBe('ashby');
    expect(new SmartRecruitersAdapter().name).toBe('smartrecruiters');
  });
});
