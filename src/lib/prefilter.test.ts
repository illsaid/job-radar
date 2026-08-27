import { describe, it, expect } from 'vitest';
import { prefilterJob, evaluateGeography } from '@/lib/prefilter';

describe('geography gate', () => {
  it('passes Los Angeles area locations', () => {
    expect(evaluateGeography('Los Angeles, CA').state).toBe('PASS');
    expect(evaluateGeography('Culver City, CA').state).toBe('PASS');
    expect(evaluateGeography('Santa Monica, CA').state).toBe('PASS');
    expect(evaluateGeography('Burbank, CA').state).toBe('PASS');
  });

  it('passes remote US patterns', () => {
    expect(evaluateGeography('Remote - US').state).toBe('PASS');
    expect(evaluateGeography('Remote US').state).toBe('PASS');
    expect(evaluateGeography('United States - Remote').state).toBe('PASS');
    expect(evaluateGeography('US Remote').state).toBe('PASS');
    expect(evaluateGeography('Remote - US & Canada').state).toBe('PASS');
  });

  it('fails clearly non-LA/non-remote cities', () => {
    expect(evaluateGeography('New York, NY').state).toBe('FAIL');
    expect(evaluateGeography('San Francisco, CA').state).toBe('FAIL');
    expect(evaluateGeography('Seattle, WA').state).toBe('FAIL');
    expect(evaluateGeography('Austin, TX').state).toBe('FAIL');
    expect(evaluateGeography('London, UK').state).toBe('FAIL');
  });

  it('returns UNKNOWN for absent or ambiguous locations', () => {
    expect(evaluateGeography(null).state).toBe('UNKNOWN');
    expect(evaluateGeography('').state).toBe('UNKNOWN');
    expect(evaluateGeography('Various locations').state).toBe('UNKNOWN');
  });

  it('allows multi-location with at least one acceptable site', () => {
    expect(evaluateGeography('New York, NY | Remote - US').state).toBe('PASS');
    expect(evaluateGeography('San Francisco / Los Angeles').state).toBe('PASS');
  });
});

describe('role relevance gate', () => {
  it('flags AI production operations director as STRONG', () => {
    const result = prefilterJob(
      'Director, AI Production Operations',
      'Los Angeles, CA',
      'Lead production systems and workflow automation for entertainment content.',
    );
    expect(result.relevant).toBe(true);
    expect(result.roleStrength).toBe('STRONG');
    expect(result.geography).toBe('PASS');
    expect(result.positiveHits).toContain('production operations');
    expect(result.positiveHits).toContain('workflow automation');
  });

  it('flags unscripted production director as relevant', () => {
    const result = prefilterJob(
      'Director of Unscripted Production',
      'Culver City, CA',
      'Manage entertainment media production operations for digital content.',
    );
    expect(result.relevant).toBe(true);
    expect(result.positiveHits).toContain('production operations');
  });

  it('flags creative technology / AI workflow lead as relevant', () => {
    const result = prefilterJob(
      'Creative Technology / AI Workflow Lead',
      'Remote - US',
      'Drive AI adoption and workflow transformation across media operations.',
    );
    expect(result.relevant).toBe(true);
    expect(result.positiveHits).toContain('creative technology');
    expect(result.positiveHits).toContain('ai workflow');
  });

  it('filters senior software engineer (discipline exclusion)', () => {
    const result = prefilterJob(
      'Senior Software Engineer, Generative AI',
      'Remote - US',
      'Build backend engineer systems, ML engineer focus.',
    );
    expect(result.relevant).toBe(false);
    expect(result.negativeHits).toContain('software engineer');
    expect(result.negativeHits).toContain('backend engineer');
    expect(result.negativeHits).toContain('ml engineer');
  });

  it('filters enterprise account executive', () => {
    const result = prefilterJob(
      'Enterprise Account Executive, Media AI',
      'Los Angeles, CA',
      'Quota carrying, commission based sales role.',
    );
    expect(result.relevant).toBe(false);
    expect(result.negativeHits).toContain('account executive');
    expect(result.negativeHits).toContain('quota carrying');
    expect(result.negativeHits).toContain('commission');
  });

  it('filters jobs in non-LA cities (geography FAIL)', () => {
    const result = prefilterJob(
      'Director of Production Operations',
      'New York, NY',
      'Manage production operations for digital media content.',
    );
    expect(result.relevant).toBe(false);
    expect(result.geography).toBe('FAIL');
  });

  it('filters jobs with only generic keywords', () => {
    const result = prefilterJob(
      'Office Manager',
      'Los Angeles, CA',
      'Manage office operations and scheduling.',
    );
    expect(result.relevant).toBe(false);
    expect(result.roleStrength).toBe('WEAK');
  });

  it('does not let "content" alone qualify a job', () => {
    const result = prefilterJob(
      'Content Reviewer',
      'Remote - US',
      'Review content for quality assurance.',
    );
    expect(result.relevant).toBe(false);
    expect(result.roleStrength).toBe('WEAK');
  });

  it('flags program manager in media domain as relevant (conditional concept)', () => {
    const result = prefilterJob(
      'Senior Program Manager, Media Operations',
      'Los Angeles, CA',
      'Lead program management for media and content production initiatives.',
    );
    expect(result.relevant).toBe(true);
    expect(result.positiveHits).toContain('program management');
  });

  it('penalizes coordinator titles with no strong match', () => {
    const result = prefilterJob(
      'Production Coordinator',
      'Los Angeles, CA',
      'Support production scheduling and logistics.',
    );
    expect(result.relevant).toBe(false);
    expect(result.juniorPenalty).toBe(true);
  });

  it('retains coordinator title if strong concept match exists', () => {
    const result = prefilterJob(
      'Production Operations Coordinator',
      'Los Angeles, CA',
      'Support production operations and workflow automation for content.',
    );
    expect(result.relevant).toBe(true);
    expect(result.juniorPenalty).toBe(true);
    expect(result.positiveHits).toContain('production operations');
  });

  it('allows UNKNOWN geography with strong role match', () => {
    const result = prefilterJob(
      'Director of Production Operations',
      null,
      'Lead production operations and workflow automation.',
    );
    expect(result.relevant).toBe(true);
    expect(result.geography).toBe('UNKNOWN');
  });

  it('filters UNKNOWN geography with WEAK role', () => {
    const result = prefilterJob(
      'Office Manager',
      null,
      'Manage office supplies.',
    );
    expect(result.relevant).toBe(false);
    expect(result.geography).toBe('UNKNOWN');
  });

  it('filters ML engineer even with LA location', () => {
    const result = prefilterJob(
      'Machine Learning Engineer',
      'Los Angeles, CA',
      'Build ML models for video production.',
    );
    expect(result.relevant).toBe(false);
    expect(result.negativeHits).toContain('machine learning engineer');
  });

  it('flags line producer as STRONG', () => {
    const result = prefilterJob(
      'Line Producer, Unscripted',
      'Los Angeles, CA',
      'Manage production operations and budget for unscripted television.',
    );
    expect(result.relevant).toBe(true);
    expect(result.positiveHits).toContain('line producer');
  });

  it('produces a human-readable reason string', () => {
    const result = prefilterJob(
      'Director, AI Production Operations',
      'Los Angeles, CA',
      'Lead production systems and workflow automation.',
    );
    expect(result.reason).toContain('STRONG');
    expect(result.reason).toContain('PASS');
  });
});
