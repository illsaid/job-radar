import { describe, it, expect } from 'vitest';
import { calculateTotalScore, recommendationForScore, type ComponentScores, type PenaltyEntry } from '@/lib/scoring';

const maxComponents: ComponentScores = {
  production_operations: 25,
  ai_workflow: 20,
  media_domain: 15,
  leadership: 15,
  transferability: 10,
  seniority: 10,
  location: 5,
};

const zeroComponents: ComponentScores = {
  production_operations: 0,
  ai_workflow: 0,
  media_domain: 0,
  leadership: 0,
  transferability: 0,
  seniority: 0,
  location: 0,
};

describe('recommendation thresholds', () => {
  it('65 => WATCH', () => {
    expect(recommendationForScore(65)).toBe('WATCH');
  });

  it('74 => WATCH', () => {
    expect(recommendationForScore(74)).toBe('WATCH');
  });

  it('75 => STRONG_REVIEW', () => {
    expect(recommendationForScore(75)).toBe('STRONG_REVIEW');
  });

  it('81 => STRONG_REVIEW', () => {
    expect(recommendationForScore(81)).toBe('STRONG_REVIEW');
  });

  it('82 => APPLY_NOW', () => {
    expect(recommendationForScore(82)).toBe('APPLY_NOW');
  });

  it('89 => APPLY_NOW', () => {
    expect(recommendationForScore(89)).toBe('APPLY_NOW');
  });

  it('90 => EXCEPTIONAL', () => {
    expect(recommendationForScore(90)).toBe('EXCEPTIONAL');
  });

  it('64 => IGNORE', () => {
    expect(recommendationForScore(64)).toBe('IGNORE');
  });

  it('0 => IGNORE', () => {
    expect(recommendationForScore(0)).toBe('IGNORE');
  });

  it('100 => EXCEPTIONAL', () => {
    expect(recommendationForScore(100)).toBe('EXCEPTIONAL');
  });
});

describe('penalty arithmetic', () => {
  it('sums component values with no penalties', () => {
    const components: ComponentScores = {
      production_operations: 20,
      ai_workflow: 15,
      media_domain: 12,
      leadership: 10,
      transferability: 8,
      seniority: 8,
      location: 4,
    };
    expect(calculateTotalScore(components, [])).toBe(77);
  });

  it('subtracts penalty points from component sum', () => {
    const penalties: PenaltyEntry[] = [
      { reason: 'QA testing as primary discipline', points: -22 },
    ];
    const components: ComponentScores = {
      production_operations: 3,
      ai_workflow: 8,
      media_domain: 8,
      leadership: 8,
      transferability: 8,
      seniority: 4,
      location: 3,
    };
    expect(calculateTotalScore(components, penalties)).toBe(20);
  });

  it('sums multiple penalties correctly', () => {
    const penalties: PenaltyEntry[] = [
      { reason: 'Seasonal role', points: -8 },
      { reason: 'Entry-level', points: -25 },
    ];
    const components: ComponentScores = {
      production_operations: 12,
      ai_workflow: 0,
      media_domain: 8,
      leadership: 0,
      transferability: 5,
      seniority: 0,
      location: 5,
    };
    expect(calculateTotalScore(components, penalties)).toBe(0);
  });
});

describe('score clamping', () => {
  it('clamps negative scores to 0', () => {
    const penalties: PenaltyEntry[] = [
      { reason: 'Entry-level', points: -25 },
      { reason: 'Seasonal', points: -8 },
    ];
    expect(calculateTotalScore(zeroComponents, penalties)).toBe(0);
  });

  it('clamps scores above 100 to 100', () => {
    expect(calculateTotalScore(maxComponents, [])).toBe(100);
  });

  it('does not clamp when score is within range', () => {
    const components: ComponentScores = {
      production_operations: 18,
      ai_workflow: 19,
      media_domain: 15,
      leadership: 13,
      transferability: 8,
      seniority: 9,
      location: 5,
    };
    expect(calculateTotalScore(components, [])).toBe(87);
  });

  it('clamps to 0 when penalties exactly cancel components', () => {
    const components: ComponentScores = {
      production_operations: 10,
      ai_workflow: 10,
      media_domain: 10,
      leadership: 10,
      transferability: 10,
      seniority: 10,
      location: 5,
    };
    const penalties: PenaltyEntry[] = [
      { reason: 'Massive penalty', points: -65 },
    ];
    expect(calculateTotalScore(components, penalties)).toBe(0);
  });
});
