import type { JobSourceAdapter } from './types';
import { GreenhouseAdapter } from './greenhouse';
import { LeverAdapter } from './lever';
import { AshbyAdapter } from './ashby';
import { SmartRecruitersAdapter } from './smartrecruiters';

export type { JobSourceAdapter, NormalizedJob, AdapterFetchOptions } from './types';
export { computeContentHash, normalizedJobSchema } from './types';

const adapters: Record<string, JobSourceAdapter> = {
  greenhouse: new GreenhouseAdapter(),
  lever: new LeverAdapter(),
  ashby: new AshbyAdapter(),
  smartrecruiters: new SmartRecruitersAdapter(),
};

export function getAdapter(atsType: string): JobSourceAdapter | null {
  return adapters[atsType] ?? null;
}

export const SUPPORTED_ATS_TYPES = Object.keys(adapters);
