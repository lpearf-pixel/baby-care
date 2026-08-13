import { describe, expect, it } from 'vitest';
import { isValidTraceId, resolveTraceId } from '../src/trace-id.js';

describe('trace ids', () => {
  it('preserves a valid caller trace id', () => {
    expect(isValidTraceId('care-20260813-001')).toBe(true);
    expect(resolveTraceId('care-20260813-001')).toBe('care-20260813-001');
  });

  it('rejects unsafe or oversized caller values', () => {
    expect(isValidTraceId('bad trace')).toBe(false);
    expect(isValidTraceId('bad\ntrace')).toBe(false);
    expect(isValidTraceId('x'.repeat(129))).toBe(false);
  });

  it('generates a safe fallback when caller trace id is missing or invalid', () => {
    const generated = resolveTraceId('bad trace');
    expect(generated).not.toBe('bad trace');
    expect(isValidTraceId(generated)).toBe(true);
  });
});
