import { describe, expect, it } from 'vitest';
import { DiagnosticEventSchema, createDiagnosticEvent } from '../src/diagnostic-event.js';

describe('DiagnosticEventSchema', () => {
  it('accepts a compact machine-readable diagnostic event', () => {
    const result = DiagnosticEventSchema.safeParse({
      schema_version: 1,
      timestamp: '2026-08-13T06:40:00.000Z',
      trace_id: 'trace-123',
      component: 'contracts',
      event_code: 'CONTRACT_TEST_FAILED',
      severity: 'error',
      message: 'health contract mismatch',
      expected: 'database=ok',
      actual: 'database=warming_up',
      evidence_pointer: 'artifact://diagnostics/trace-123',
    });

    expect(result.success).toBe(true);
  });

  it('rejects events without event_code', () => {
    const result = DiagnosticEventSchema.safeParse({
      schema_version: 1,
      timestamp: '2026-08-13T06:40:00.000Z',
      trace_id: 'trace-123',
      component: 'contracts',
      severity: 'error',
      message: 'missing code',
    });

    expect(result.success).toBe(false);
  });

  it('creates a schema-valid event with caller fields', () => {
    const event = createDiagnosticEvent({
      trace_id: 'trace-456',
      component: 'api',
      event_code: 'API_HEALTH_DEGRADED',
      severity: 'warn',
      message: 'database unavailable',
      actual: 'unavailable',
    });

    expect(DiagnosticEventSchema.safeParse(event).success).toBe(true);
    expect(event.trace_id).toBe('trace-456');
    expect(event.schema_version).toBe(1);
  });
});
