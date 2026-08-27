export interface ScoreThreshold {
  min: number;
  max: number;
  label: string;
  category: 'exceptional' | 'apply_now' | 'strong_review' | 'watch' | 'ignore';
  urgency: 'critical' | 'high' | 'moderate' | 'low' | 'none';
  color: string;
  alertImmediately: boolean;
}

export const SCORE_THRESHOLDS: ScoreThreshold[] = [
  {
    min: 90,
    max: 100,
    label: 'EXCEPTIONAL MATCH',
    category: 'exceptional',
    urgency: 'critical',
    color: 'emerald',
    alertImmediately: true,
  },
  {
    min: 82,
    max: 89,
    label: 'APPLY NOW',
    category: 'apply_now',
    urgency: 'high',
    color: 'cyan',
    alertImmediately: true,
  },
  {
    min: 75,
    max: 81,
    label: 'STRONG REVIEW',
    category: 'strong_review',
    urgency: 'moderate',
    color: 'amber',
    alertImmediately: true,
  },
  {
    min: 65,
    max: 74,
    label: 'WATCH',
    category: 'watch',
    urgency: 'low',
    color: 'slate',
    alertImmediately: false,
  },
  {
    min: 0,
    max: 64,
    label: 'IGNORE',
    category: 'ignore',
    urgency: 'none',
    color: 'zinc',
    alertImmediately: false,
  },
];

export const HIGH_PRIORITY_ALERT_THRESHOLD = 72;

export function getThreshold(score: number): ScoreThreshold {
  return SCORE_THRESHOLDS.find((t) => score >= t.min && score <= t.max) ?? SCORE_THRESHOLDS[SCORE_THRESHOLDS.length - 1];
}

export function shouldAlert(score: number, companyPriority: number): boolean {
  const threshold = getThreshold(score);
  if (threshold.alertImmediately) return true;
  if (companyPriority === 1 && score >= HIGH_PRIORITY_ALERT_THRESHOLD) return true;
  return false;
}
