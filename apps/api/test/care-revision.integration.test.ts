import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected session cookie pair');
  return pair;
}

async function createNanny(context: Awaited<ReturnType<typeof createM2TestApp>>) {
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/family/members',
    headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
    payload: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' },
  });
  expect(created.statusCode).toBe(201);
  const login = await context.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: M2_TEST_ORIGIN },
    payload: { loginName: 'nanny', password: 'nanny-test-password' },
  });
  expect(login.statusCode).toBe(200);
  return {
    cookie: cookieFrom(login as unknown as { headers: Record<string, unknown> }),
    userId: login.json().userId as string,
  };
}

describeDatabase('M2 care revisions', () => {
  it('edits a Dad-created diaper as Nanny while preserving original actor/source and recording edit actor', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/care/diapers',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          occurredAt: '2026-08-13T07:50:00.000Z',
          clientRequestId: randomUUID(),
          kind: 'urine',
        },
      });
      expect(created.statusCode).toBe(201);
      const eventId = created.json().id as string;
      const before = await context.database.pool.query(
        `select actor_user_id, actor_membership_id, source, version from care_events where id = $1`,
        [eventId],
      );
      const nanny = await createNanny(context);

      const edited = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: nanny.cookie },
        payload: {
          eventType: 'diaper',
          occurredAt: '2026-08-13T07:51:00.000Z',
          kind: 'stool',
          stoolColor: 'yellow',
          stoolConsistency: 'seedy',
          stoolAmount: 'small',
        },
      });
      expect(edited.statusCode).toBe(200);

      const after = await context.database.pool.query(
        `select actor_user_id, actor_membership_id, source, version, occurred_at from care_events where id = $1`,
        [eventId],
      );
      expect(after.rows[0].actor_user_id).toBe(before.rows[0].actor_user_id);
      expect(after.rows[0].actor_membership_id).toBe(before.rows[0].actor_membership_id);
      expect(after.rows[0].source).toBe('manual');
      expect(after.rows[0].version).toBe(2);
      expect(new Date(after.rows[0].occurred_at).toISOString()).toBe('2026-08-13T07:51:00.000Z');

      const diaper = await context.database.pool.query(
        `select kind, stool_color, stool_consistency, stool_amount from diaper_events where event_id = $1`,
        [eventId],
      );
      expect(diaper.rows[0]).toEqual({
        kind: 'stool',
        stool_color: 'yellow',
        stool_consistency: 'seedy',
        stool_amount: 'small',
      });
      const revisions = await context.database.pool.query(
        `select edit_actor_user_id, revision_action, before_json, after_json from care_event_revisions where event_id = $1`,
        [eventId],
      );
      expect(revisions.rows).toHaveLength(1);
      expect(revisions.rows[0].edit_actor_user_id).toBe(nanny.userId);
      expect(revisions.rows[0].revision_action).toBe('edit');
      expect(revisions.rows[0].before_json).toMatchObject({ kind: 'urine' });
      expect(revisions.rows[0].after_json).toMatchObject({ kind: 'stool' });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('rejects an edit discriminator that does not match the stored event type', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/care/diapers',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:50:00.000Z', clientRequestId: randomUUID(), kind: 'urine' },
      });
      const response = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${created.json().id}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          eventType: 'feeding',
          occurredAt: '2026-08-13T07:50:00.000Z',
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60 }],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'care_state_conflict' });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('edits sleep, action, and measurement payloads without changing original ownership', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const sleep = await context.app.inject({
        method: 'POST', url: '/api/care/sleep/start',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:20:00.000Z', clientRequestId: randomUUID() },
      });
      const crying = await context.app.inject({
        method: 'POST', url: '/api/care/actions',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:40:00.000Z', clientRequestId: randomUUID(), action: { kind: 'crying', durationMinutes: 5 } },
      });
      const temperature = await context.app.inject({
        method: 'POST', url: '/api/care/measurements',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:50:00.000Z', clientRequestId: randomUUID(), measurement: { kind: 'temperature', valueCelsius: 37.1, method: 'axillary' } },
      });
      expect([sleep.statusCode, crying.statusCode, temperature.statusCode]).toEqual([201, 201, 201]);

      expect((await context.app.inject({
        method: 'PATCH', url: `/api/care/events/${sleep.json().id}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { eventType: 'sleep', startedAt: '2026-08-13T07:15:00.000Z', endedAt: '2026-08-13T07:35:00.000Z' },
      })).statusCode).toBe(200);
      expect((await context.app.inject({
        method: 'PATCH', url: `/api/care/events/${crying.json().id}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { eventType: 'crying', occurredAt: '2026-08-13T07:41:00.000Z', action: { kind: 'crying', durationMinutes: 9 } },
      })).statusCode).toBe(200);
      expect((await context.app.inject({
        method: 'PATCH', url: `/api/care/events/${temperature.json().id}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { eventType: 'temperature', occurredAt: '2026-08-13T07:51:00.000Z', measurement: { kind: 'temperature', valueCelsius: 37.3, method: 'axillary' } },
      })).statusCode).toBe(200);

      const sleepRow = await context.database.pool.query(`select started_at, ended_at from sleep_intervals where event_id = $1`, [sleep.json().id]);
      expect(new Date(sleepRow.rows[0].started_at).toISOString()).toBe('2026-08-13T07:15:00.000Z');
      expect(new Date(sleepRow.rows[0].ended_at).toISOString()).toBe('2026-08-13T07:35:00.000Z');
      const actionRow = await context.database.pool.query(`select crying_duration_minutes from care_actions where event_id = $1`, [crying.json().id]);
      expect(actionRow.rows[0].crying_duration_minutes).toBe(9);
      const measurementRow = await context.database.pool.query(`select value::float8 as value from measurements where event_id = $1`, [temperature.json().id]);
      expect(measurementRow.rows[0].value).toBe(37.3);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
