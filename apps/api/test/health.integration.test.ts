import { afterEach, describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '@baby-care/contracts';
import { buildApp } from '../src/app.js';

const fixedDate = new Date('2026-08-13T06:30:00.000Z');
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /health', () => {
  it('returns 200 and a valid healthy contract when PostgreSQL is reachable', async () => {
    const app = buildApp({ checkDatabase: async () => true, now: () => fixedDate });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('returns 503 and a valid degraded contract when PostgreSQL is unavailable', async () => {
    const app = buildApp({ checkDatabase: async () => false, now: () => fixedDate });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json();

    expect(response.statusCode).toBe(503);
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ status: 'degraded', database: 'unavailable' });
  });

  it('preserves a safe caller trace id in the response header', async () => {
    const app = buildApp({ checkDatabase: async () => true, now: () => fixedDate });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-trace-id': 'care-health-001' },
    });

    expect(response.headers['x-trace-id']).toBe('care-health-001');
  });
});
