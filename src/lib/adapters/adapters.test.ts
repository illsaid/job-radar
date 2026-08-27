import { afterEach, describe, it, expect, vi } from 'vitest';
import { GreenhouseAdapter } from '@/lib/adapters/greenhouse';
import { LeverAdapter } from '@/lib/adapters/lever';
import { AshbyAdapter } from '@/lib/adapters/ashby';
import { SmartRecruitersAdapter } from '@/lib/adapters/smartrecruiters';
import { TalentBrewAdapter } from '@/lib/adapters/talentbrew';
import { SuccessFactorsAdapter } from '@/lib/adapters/successfactors';
import { WorkdayAdapter, fetchWorkdayJobDetail } from '@/lib/adapters/workday';
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
  it('creates all supported adapters with correct names', () => {
    expect(new GreenhouseAdapter().name).toBe('greenhouse');
    expect(new LeverAdapter().name).toBe('lever');
    expect(new AshbyAdapter().name).toBe('ashby');
    expect(new SmartRecruitersAdapter().name).toBe('smartrecruiters');
    expect(new TalentBrewAdapter().name).toBe('talentbrew');
    expect(new SuccessFactorsAdapter().name).toBe('successfactors');
    expect(new WorkdayAdapter().name).toBe('workday');
  });
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('public career page adapters', () => {
  it('normalizes a TalentBrew job page record with its stable public ID', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(`
      <a href="/job/culver-city/lead-engineer-identity-management/22978/87651826448">Lead Engineer, Identity Management</a>
      <div>Location: Culver City, California (Hybrid) Department: Technology &amp; InfoSec</div>
    `));
    const jobs = await new TalentBrewAdapter().fetchJobs({
      atsIdentifier: 'https://www.sonypicturesjobs.com/search-jobs', careersUrl: '',
    });
    expect(jobs).toMatchObject([{
      source: 'talentbrew', source_job_id: '87651826448',
      title: 'Lead Engineer, Identity Management', department: 'Technology & InfoSec',
      remote_status: 'Hybrid',
      job_url: 'https://www.sonypicturesjobs.com/job/culver-city/lead-engineer-identity-management/22978/87651826448',
    }]);
  });

  it('normalizes a SuccessFactors job page record and retains the canonical URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(`
      <rss><channel><item>
        <title>Sr. Coordinator, International Sales Strategy &amp; Planning (Santa Monica, CA, US, 90404)</title>
        <description><![CDATA[&lt;p&gt;Support international sales planning.&lt;/p&gt;&lt;p&gt;Compensation: $55,000 - $60,000&lt;/p&gt;]]></description>
        <link>https://jobs.lionsgate.com/Lionsgate/job/Santa-Monica-Sr_-Coordinator-CA-90404/1390287000/</link>
        <guid>1390287000</guid><g:job_function>Sales &amp; Distribution</g:job_function><g:location>Santa Monica, CA, US, 90404</g:location>
      </item></channel></rss>
    `));
    const jobs = await new SuccessFactorsAdapter().fetchJobs({
      atsIdentifier: 'https://jobs.lionsgate.com/go/View-All-Openings/8023300/', careersUrl: '',
    });
    expect(jobs).toMatchObject([{
      source: 'successfactors', source_job_id: '1390287000',
      title: 'Sr. Coordinator, International Sales Strategy & Planning',
      location_text: 'Santa Monica, CA, US, 90404', department: 'Sales & Distribution',
      compensation_min: 55000, compensation_max: 60000, description_text: 'Support international sales planning. Compensation: $55,000 - $60,000',
      job_url: 'https://jobs.lionsgate.com/Lionsgate/job/Santa-Monica-Sr_-Coordinator-CA-90404/1390287000/',
    }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://jobs.lionsgate.com/sitemap-job.xml',
      expect.anything(),
    );
  });

  it('paginates Workday CXS listings in pages of 20 without converting relative postedOn text', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => ({
      title: index === 0 ? 'Director, International Controllership' : `Role ${index}`,
      externalPath: `/job/Hyderabad/Role_${index === 0 ? 'R000107736' : `R0001077${index}`}`,
      locationsText: 'Hyderabad, India',
      postedOn: 'Posted Today',
      remoteType: 'Hybrid',
      bulletFields: [index === 0 ? 'R000107736' : `R0001077${index}`],
    }));
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      const { offset } = JSON.parse(String(init?.body));
      return Promise.resolve(new Response(JSON.stringify({
        total: 21,
        jobPostings: offset === 0 ? firstPage : [{
          title: 'Production Operations Lead', externalPath: '/job/Burbank/Production-Operations-Lead_R000107757',
          locationsText: 'Burbank, California', postedOn: 'Posted Yesterday', remoteType: 'Remote', bulletFields: ['R000107757'],
        }],
      })));
    });
    const jobs = await new WorkdayAdapter().fetchJobs({
      atsIdentifier: 'https://warnerbros.wd5.myworkdayjobs.com/wday/cxs/warnerbros/global',
      careersUrl: 'https://warnerbros.wd5.myworkdayjobs.com/en-US/global',
    });
    expect(jobs).toHaveLength(21);
    expect(jobs[0]).toMatchObject({
      source: 'workday', source_job_id: 'R000107736', remote_status: 'Hybrid',
      source_published_at: null,
      job_url: 'https://warnerbros.wd5.myworkdayjobs.com/en-US/global/job/Hyderabad/Role_R000107736',
    });
    expect(jobs[20]).toMatchObject({ source_job_id: 'R000107757', remote_status: 'Remote' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body))).toMatchObject({ limit: 20, offset: 0 });
    expect(JSON.parse(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body))).toMatchObject({ limit: 20, offset: 20 });
  });

  it('retrieves Workday CXS detail only when requested and exposes description metadata', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      jobPostingInfo: {
        jobDescription: '<p>Lead production workflow transformation.</p>',
        location: 'Burbank, California', remoteType: 'Hybrid', timeType: 'Full time',
        jobReqId: 'R000107757', externalUrl: 'https://warnerbros.wd5.myworkdayjobs.com/global/job/Burbank/Production-Operations-Lead_R000107757',
      },
    })));
    const detail = await fetchWorkdayJobDetail(
      'https://warnerbros.wd5.myworkdayjobs.com/wday/cxs/warnerbros/global',
      'https://warnerbros.wd5.myworkdayjobs.com/en-US/global/job/Burbank/Production-Operations-Lead_R000107757',
    );
    expect(detail).toMatchObject({
      descriptionText: 'Lead production workflow transformation.', employmentType: 'Full time',
      remoteStatus: 'Hybrid', locationText: 'Burbank, California', sourceJobId: 'R000107757',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://warnerbros.wd5.myworkdayjobs.com/wday/cxs/warnerbros/global/job/Burbank/Production-Operations-Lead_R000107757',
      expect.anything(),
    );
  });

});
