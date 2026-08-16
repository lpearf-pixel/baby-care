import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function postSleep(app: Awaited<ReturnType<typeof createM2TestApp>>['app'], cookie: string, action: 'start' | 'wake', payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/care/sleep/${action}`,
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload,
  });
}

describeDatabase('M2 sleep recording', () => {
  it('starts and wakes a sleep interval with explicit backfilled times', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const started = await postSleep(app, cookie, 'start', {
        occurredAt: '2026-08-13T07:40:00.000Z',
        clientRequestId: randomUUID(),
      });
      expect(started.statusCode).toBe(201);
      const eventId = started.json().id as string;

      const wake = await postSleep(app, cookie, 'wake', {
        occurredAt: '2026-08-13T07:50:00.000Z',
        clientRequestId: randomUUID(),
      });
      expect(wake.statusCode).toBe(200);

      const stored = await database.pool.query(
        `select started_at, ended_at from sleep_intervals where event_id = $1`,
        [eventId],
      );
      expect(new Date(stored.rows[0].started_at).toISOString()).toBe('2026-08-13T07:40:00.000Z');
      expect(new Date(stored.rows[0].ended_at).toISOString()).toBe('2026-08-13T07:50:00.000Z');
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('rejects wake without an open interval and warns before a second open interval', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const wakeWithoutStart = await postSleep(app, cookie, 'wake', {
        occurredAt: '2026-08-13T07:50:00.000Z',
        clientRequestId: randomUUID(),
      });
      expect(wakeWithoutStart.statusCode).toBe(409);
      expect(wakeWithoutStart.json()).toMatchObject({ code: 'care_state_conflict' });

      const first = await postSleep(app, cookie, 'start', {
        occurredAt: '2026-08-13T07:45:00.000Z',
        clientRequestId: randomUUID(),
      });
      expect(first.statusCode).toBe(201);

      const secondPayload = {
        occurredAt: '2026-08-13T07:55:00.000Z',
        clientRequestId: randomUUID(),
      };
      const overlap = await postSleep(app, cookie, 'start', secondPayload);
      expect(overlap.statusCode).toBe(409);
      expect(overlap.json()).toMatchObject({
        code: 'care_confirmation_required',
        details: { warnings: [{ code: 'sleep_overlap' }] },
      });

      const confirmed = await postSleep(app, cookie, 'start', {
        ...secondPayload,
        confirmedWarnings: ['sleep_overlap'],
      });
      expect(confirmed.statusCode).toBe(201);
      const count = await database.pool.query(`select count(*)::int as count from sleep_intervals`);
      expect(count.rows[0].count).toBe(2);
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('accepts five-minute clock skew, rejects later future times, and warns on old backfill', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const boundary = await postSleep(app, cookie, 'start', {
        occurredAt: '2026-08-13T08:05:00.000Z',
        clientRequestId: randomUUID(),
      });
      expect(boundary.statusCode).toBe(201);
      await postSleep(app, cookie, 'wake', {
        occurredAt: '2026-08-13T08:05:00.000Z',
        clientRequestId: randomUUID(),
      });

      const future = await postSleep(app, cookie, 'start', {
        occurredAt: '2026-08-13T08:05:01.000Z',
        clientRequestId: randomUUID(),
      });
      expect(future.statusCode).toBe(400);
      expect(future.json()).toMatchObject({ code: 'validation_failed' });

      const oldPayload = {
        occurredAt: '2026-08-12T07:59:59.000Z',
        clientRequestId: randomUUID(),
      };
      const oldWarning = await postSleep(app, cookie, 'start', oldPayload);
      expect(oldWarning.statusCode).toBe(409);
      expect(oldWarning.json()).toMatchObject({
        code: 'care_confirmation_required',
        details: { warnings: [{ code: 'old_backfill' }] },
      });
      const confirmed = await postSleep(app, cookie, 'start', {
        ...oldPayload,
        confirmedWarnings: ['old_backfill'],
      });
      expect(confirmed.statusCode).toBe(201);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
