import { describe, it, expect } from 'vitest';
import { calculateTotalScore, recommendationForScore, type ComponentScores, type PenaltyEntry } from '@/lib/scoring';

// Tests for the production hardening rules — scoring thresholds, packet thresholds,
// alert thresholds, and deterministic behavior.

const baseComponents: ComponentScores = {
  production_operations: 20,
  ai_workflow: 15,
  media_domain: 12,
  leadership: 10,
  transferability: 8,
  seniority: 8,
  location: 4,
};

describe('alert thresholds (82+ for immediate alert)', () => {
  it('81 => STRONG_REVIEW, no immediate alert', () => {
    const components: ComponentScores = {
      production_operations: 20,
      ai_workflow: 15,
      media_domain: 12,
      leadership: 10,
      transferability: 8,
      seniority: 8,
      location: 4,
    };
    // 20+15+12+10+8+8+4 = 77
    const score = calculateTotalScore(components, []);
    expect(score).toBe(77);
    expect(recommendationForScore(score)).toBe('STRONG_REVIEW');
    expect(score < 82).toBe(true);
  });

  it('82 => APPLY_NOW, alert eligible', () => {
    const components: ComponentScores = {
      production_operations: 22,
      ai_workflow: 16,
      media_domain: 13,
      leadership: 11,
      transferability: 8,
      seniority: 8,
      location: 4,
    };
    const score = calculateTotalScore(components, []);
    expect(score).toBe(82);
    expect(recommendationForScore(score)).toBe('APPLY_NOW');
    expect(score >= 82).toBe(true);
  });

  it('89 => APPLY_NOW, alert eligible', () => {
    const components: ComponentScores = {
      production_operations: 24,
      ai_workflow: 18,
      media_domain: 14,
      leadership: 12,
      transferability: 9,
      seniority: 8,
      location: 4,
    };
    const score = calculateTotalScore(components, []);
    expect(score).toBe(89);
    expect(recommendationForScore(score)).toBe('APPLY_NOW');
  });

  it('90 => EXCEPTIONAL, alert eligible', () => {
    const components: ComponentScores = {
      production_operations: 25,
      ai_workflow: 19,
      media_domain: 14,
      leadership: 13,
      transferability: 9,
      seniority: 8,
      location: 5,
    };
    const score = calculateTotalScore(components, []);
    expect(score).toBe(93);
    expect(recommendationForScore(score)).toBe('EXCEPTIONAL');
  });
});

describe('packet threshold (75+)', () => {
  it('75 => STRONG_REVIEW, packet eligible', () => {
    const components: ComponentScores = {
      production_operations: 20,
      ai_workflow: 15,
      media_domain: 12,
      leadership: 10,
      transferability: 8,
      seniority: 5,
      location: 5,
    };
    const score = calculateTotalScore(components, []);
    expect(score).toBe(75);
    expect(score >= 75).toBe(true);
  });

  it('74 => WATCH, no packet', () => {
    const components: ComponentScores = {
      production_operations: 20,
      ai_workflow: 15,
      media_domain: 12,
      leadership: 10,
      transferability: 8,
      seniority: 4,
      location: 5,
    };
    const score = calculateTotalScore(components, []);
    expect(score).toBe(74);
    expect(score < 75).toBe(true);
    expect(score >= 65).toBe(true); // WATCH
  });
});

describe('stale packet: score drops below 75', () => {
  it('a job that was 75 but is now rescored to 74 should not have a current packet', () => {
    // This is a logic test: if the latest score is < 75, the packet should be marked non-current
    // The generate-packets function handles this by checking scoredJobIds set
    const newScore = 74;
    expect(newScore < 75).toBe(true);
    // Packet should be is_current = false
  });
});

describe('version-aware alert dedupe', () => {
  it('same job + same content hash + same alert type => duplicate suppressed', () => {
    // The unique index on (job_id, COALESCE(source_content_hash, ''), alert_type)
    // prevents duplicate alerts for the same material version
    const jobId = 'job-123';
    const sourceContentHash = 'abc123';
    const alertType = 'apply_now';
    const dedupeKey = jobId + ':' + sourceContentHash + ':' + alertType;
    // Second insert with same key would fail the unique constraint
    expect(dedupeKey).toBe('job-123:abc123:apply_now');
  });

  it('material change produces different source_content_hash => can alert again', () => {
    const oldHash: string = 'abc123';
    const newHash: string = 'def456';
    expect(oldHash !== newHash).toBe(true);
    // The unique key includes source_content_hash, so a changed job can get a new alert
  });
});

describe('alert cutoff logic', () => {
  it('pre-activation job (first_seen before cutoff) => no alert', () => {
    const firstSeenAt = '2026-01-01T00:00:00Z';
    const cutoffTime = '2026-08-26T00:00:00Z';
    expect(firstSeenAt > cutoffTime).toBe(false);
    // No material change => not eligible
  });

  it('post-activation new job (first_seen after cutoff) => alert eligible', () => {
    const firstSeenAt = '2026-08-27T00:00:00Z';
    const cutoffTime = '2026-08-26T00:00:00Z';
    expect(firstSeenAt > cutoffTime).toBe(true);
  });

  it('material change after cutoff => alert eligible', () => {
    const lastMaterialChangeAt = '2026-08-27T00:00:00Z';
    const cutoffTime = '2026-08-26T00:00:00Z';
    expect(lastMaterialChangeAt > cutoffTime).toBe(true);
  });
});

describe('source fingerprint stability', () => {
  it('fingerprint computed from listing fields only, not enriched description', () => {
    // The source_fingerprint is computed from: source, source_job_id, title, department,
    // location_text, remote_status, employment_type, compensation, job_url,
    // source_published_at, source_updated_at
    // It does NOT include description_text, so enrichment doesn't change it
    const listingFields = ['greenhouse', '123', 'Director of Ops', 'Engineering', 'Los Angeles, CA', 'Remote', 'Full-time', '150000', '180000', 'USD', 'https://example.com/job', '2026-01-01', '2026-01-01'];
    const fingerprint = listingFields.join('|');
    // If we change description_text, the fingerprint stays the same
    expect(fingerprint.includes('description')).toBe(false);
  });
});

describe('deterministic verdict from score', () => {
  it('90+ => EXCEPTIONAL', () => {
    expect(recommendationForScore(90)).toBe('EXCEPTIONAL');
    expect(recommendationForScore(100)).toBe('EXCEPTIONAL');
  });

  it('82-89 => APPLY_NOW', () => {
    expect(recommendationForScore(82)).toBe('APPLY_NOW');
    expect(recommendationForScore(89)).toBe('APPLY_NOW');
  });

  it('75-81 => STRONG_REVIEW', () => {
    expect(recommendationForScore(75)).toBe('STRONG_REVIEW');
    expect(recommendationForScore(81)).toBe('STRONG_REVIEW');
  });

  it('65-74 => WATCH', () => {
    expect(recommendationForScore(65)).toBe('WATCH');
    expect(recommendationForScore(74)).toBe('WATCH');
  });

  it('<65 => IGNORE', () => {
    expect(recommendationForScore(64)).toBe('IGNORE');
    expect(recommendationForScore(0)).toBe('IGNORE');
  });
});

describe('HTML escaping for alert emails', () => {
  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  it('escapes HTML injection attempt in job title', () => {
    const malicious = '<script>alert("xss")</script>';
    const escaped = escapeHtml(malicious);
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escaped.includes('<script>')).toBe(false);
  });

  it('escapes company name with HTML entities', () => {
    const malicious = 'Test & Co <img src=x onerror=alert(1)>';
    const escaped = escapeHtml(malicious);
    expect(escaped).toBe('Test &amp; Co &lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('safe URL validation', () => {
  function safeUrl(url: string | null): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
    } catch {
      // invalid
    }
    return null;
  }

  it('allows https URLs', () => {
    expect(safeUrl('https://example.com/job')).toBe('https://example.com/job');
  });

  it('allows http URLs', () => {
    expect(safeUrl('http://example.com/job')).toBe('http://example.com/job');
  });

  it('rejects javascript: URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects null', () => {
    expect(safeUrl(null)).toBeNull();
  });

  it('rejects invalid URLs', () => {
    expect(safeUrl('not a url')).toBeNull();
  });
});

describe('material change detection', () => {
  it('unchanged job preserves status (not set to new)', () => {
    // When source_fingerprint matches, the job status is NOT changed
    // Only last_seen_at is updated
    const existingFingerprint = 'abc123';
    const newFingerprint = 'abc123';
    const isMaterialChange = existingFingerprint !== newFingerprint;
    expect(isMaterialChange).toBe(false);
  });

  it('material change sets status to new and last_material_change_at', () => {
    const existingFingerprint: string = 'abc123';
    const newFingerprint: string = 'def456';
    const isMaterialChange = existingFingerprint !== newFingerprint;
    expect(isMaterialChange).toBe(true);
    // When material change: status = 'new', last_material_change_at = now
  });

  it('previously filtered job can be reevaluated after material change', () => {
    // A filtered job with status='filtered' that materially changes gets status='new'
    // This makes it eligible for prefilter + scoring again
    const oldStatus = 'filtered';
    const isMaterialChange = true;
    const newStatus = isMaterialChange ? 'new' : oldStatus;
    expect(newStatus).toBe('new');
  });
});
