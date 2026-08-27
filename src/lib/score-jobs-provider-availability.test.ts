import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scoreJobsSource = readFileSync(
  resolve(process.cwd(), 'supabase/functions/score-jobs/index.ts'),
  'utf8',
);

describe('score-jobs provider availability', () => {
  it('leaves eligible jobs new when the model provider is unavailable', () => {
    const providerGuardStart = scoreJobsSource.indexOf('if (!provider) {');
    const jobsQueryStart = scoreJobsSource.indexOf("const { data: jobs, error: jobsError }");
    const providerGuard = scoreJobsSource.slice(providerGuardStart, jobsQueryStart);

    expect(providerGuardStart).toBeGreaterThan(-1);
    expect(jobsQueryStart).toBeGreaterThan(providerGuardStart);
    expect(providerGuard).toContain("code: 'MODEL_PROVIDER_UNAVAILABLE'");
    expect(providerGuard).toContain('status: 503');
    expect(providerGuard).not.toContain(".from('jobs')");
    expect(scoreJobsSource).not.toContain("status: 'prefiltered'");
  });
});
