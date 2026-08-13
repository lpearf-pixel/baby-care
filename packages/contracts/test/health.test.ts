import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '../src/health.js';

const timestamp = '2026-08-13T06:30:00.000Z';

describe('HealthResponseSchema', () => {
  it('accepts the healthy service/database combination', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'ok',
      service: 'baby-care-api',
      database: 'ok',
      timestamp,
    });

    expect(result.success).toBe(true);
  });

  it('accepts the degraded service/database combination', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'degraded',
      service: 'baby-care-api',
      database: 'unavailable',
      timestamp,
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown database states', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'ok',
      service: 'baby-care-api',
      database: 'warming_up',
      timestamp,
    });

    expect(result.success).toBe(false);
  });

  it('rejects inconsistent status/database combinations', () => {
    const result = HealthResponseSchema.safeParse({
      status: 'ok',
      service: 'baby-care-api',
      database: 'unavailable',
      timestamp,
    });

    expect(result.success).toBe(false);
  });
});
