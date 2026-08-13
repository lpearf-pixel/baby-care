import { describe, expect, it } from 'vitest';
import { buildDiagnosticSummary, truncateEvidence } from '../src/diagnostic-pack.js';

describe('compact diagnostic packs', () => {
  it('keeps summary evidence bounded', () => {
    const long = 'x'.repeat(10_000);
    const summary = buildDiagnosticSummary({
      status: 'failure',
      stage: 'unit',
      component: 'web',
      event_code: 'WEB_TEST_FAILED',
      evidence: long,
    });

    expect(summary.evidence.length).toBeLessThanOrEqual(2048);
    expect(summary.evidence).toContain('[truncated]');
  });

  it('preserves short useful evidence verbatim', () => {
    expect(truncateEvidence('App.test.tsx: expected 系统在线', 256)).toBe(
      'App.test.tsx: expected 系统在线',
    );
  });

  it('uses stable machine-readable keys', () => {
    const summary = buildDiagnosticSummary({
      status: 'failure',
      stage: 'static',
      component: 'api',
      event_code: 'TYPECHECK_FAILED',
      evidence: 'src/app.ts:12',
    });

    expect(summary).toMatchObject({
      schema_version: 1,
      status: 'failure',
      stage: 'static',
      component: 'api',
      event_code: 'TYPECHECK_FAILED',
    });
    expect(summary.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
