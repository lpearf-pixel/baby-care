import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function postDiaper(app: Awaited<ReturnType<typeof createM2TestApp>>['app'], cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/care/diapers',
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload,
  });
}

describeDatabase('M2 diaper warnings', () => {
  it('warns on a likely duplicate and permits explicit confirmation', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const first = await postDiaper(app, cookie, {
        occurredAt: '2026-08-13T07:50:00.000Z',
        clientRequestId: randomUUID(),
        kind: 'urine',
      });
      expect(first.statusCode).toBe(201);

      const payload = {
        occurredAt: '2026-08-13T07:52:00.000Z',
        clientRequestId: randomUUID(),
        kind: 'urine',
      };
      const warning = await postDiaper(app, cookie, payload);
      expect(warning.statusCode).toBe(409);
      expect(warning.json()).toMatchObject({
        code: 'care_confirmation_required',
        details: { warnings: [{ code: 'possible_duplicate' }] },
      });

      const confirmed = await postDiaper(app, cookie, {
        ...payload,
        confirmedWarnings: ['possible_duplicate'],
      });
      expect(confirmed.statusCode).toBe(201);
      const count = await database.pool.query(`select count(*)::int as count from diaper_events`);
      expect(count.rows[0].count).toBe(2);
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('enforces future skew and treats old backfill as a soft warning', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const atBoundary = await postDiaper(app, cookie, {
        occurredAt: '2026-08-13T08:05:00.000Z',
        clientRequestId: randomUUID(),
        kind: 'stool',
      });
      expect(atBoundary.statusCode).toBe(201);

      const future = await postDiaper(app, cookie, {
        occurredAt: '2026-08-13T08:05:01.000Z',
        clientRequestId: randomUUID(),
        kind: 'urine',
      });
      expect(future.statusCode).toBe(400);
      expect(future.json()).toMatchObject({ code: 'validation_failed' });

      const oldPayload = {
        occurredAt: '2026-08-12T07:59:59.000Z',
        clientRequestId: randomUUID(),
        kind: 'stool',
      };
      const oldWarning = await postDiaper(app, cookie, oldPayload);
      expect(oldWarning.statusCode).toBe(409);
      expect(oldWarning.json()).toMatchObject({
        code: 'care_confirmation_required',
        details: { warnings: [{ code: 'old_backfill' }] },
      });

      const confirmed = await postDiaper(app, cookie, {
        ...oldPayload,
        confirmedWarnings: ['old_backfill'],
      });
      expect(confirmed.statusCode).toBe(201);
      const count = await database.pool.query(`select count(*)::int as count from diaper_events`);
      expect(count.rows[0].count).toBe(2);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
