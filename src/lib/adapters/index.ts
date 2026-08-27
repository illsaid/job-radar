import type { JobSourceAdapter } from './types';
import { GreenhouseAdapter } from './greenhouse';
import { LeverAdapter } from './lever';
import { AshbyAdapter } from './ashby';
import { SmartRecruitersAdapter } from './smartrecruiters';
import { TalentBrewAdapter } from './talentbrew';
import { SuccessFactorsAdapter } from './successfactors';
import { WorkdayAdapter } from './workday';

export type { JobSourceAdapter, NormalizedJob, AdapterFetchOptions } from './types';
export { computeContentHash, normalizedJobSchema } from './types';

const adapters: Record<string, JobSourceAdapter> = {
  greenhouse: new GreenhouseAdapter(),
  lever: new LeverAdapter(),
  ashby: new AshbyAdapter(),
  smartrecruiters: new SmartRecruitersAdapter(),
  talentbrew: new TalentBrewAdapter(),
  successfactors: new SuccessFactorsAdapter(),
  workday: new WorkdayAdapter(),
};

export function getAdapter(atsType: string): JobSourceAdapter | null {
  return adapters[atsType] ?? null;
}

export const SUPPORTED_ATS_TYPES = Object.keys(adapters);
