import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CareActorContext } from '../src/care/care-auth.js';
import { createRevisionQueryService } from '../src/care/revision-query-service.js';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function sessionCookie(response: { headers: Record<string, unknown> }): string {
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
    cookie: sessionCookie(login as unknown as { headers: Record<string, unknown> }),
    actor: login.json() as CareActorContext & { displayName: string },
  };
}

describeDatabase('M3 version-aware care revisions', () => {
  it('rejects stale edit and undo before child payload reads or mutations', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const nanny = await createNanny(context);
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/care/diapers',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          occurredAt: '2026-08-13T07:40:00.000Z',
          clientRequestId: randomUUID(),
          kind: 'urine',
        },
      });
      expect(created.statusCode).toBe(201);
      const eventId = created.json().id as string;

      const [dadCopy, nannyCopy] = await Promise.all([
        context.app.inject({ method: 'GET', url: `/api/care/events/${eventId}`, headers: { cookie: context.cookie } }),
        context.app.inject({ method: 'GET', url: `/api/care/events/${eventId}`, headers: { cookie: nanny.cookie } }),
      ]);
      expect(dadCopy.json().version).toBe(1);
      expect(nannyCopy.json().version).toBe(1);

      const editedEvent = {
        eventType: 'diaper' as const,
        occurredAt: '2026-08-13T07:41:00.000Z',
        kind: 'stool' as const,
        stoolColor: 'yellow',
        stoolConsistency: 'seedy',
        stoolAmount: 'small',
      };
      const edited = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { expectedVersion: 1, event: editedEvent },
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({ id: eventId, status: 'active', version: 2 });

      const staleEdit = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: nanny.cookie },
        payload: {
          expectedVersion: 1,
          event: { ...editedEvent, occurredAt: '2026-08-13T07:42:00.000Z', kind: 'urine' },
        },
      });
      const staleUndo = await context.app.inject({
        method: 'POST',
        url: `/api/care/events/${eventId}/undo`,
        headers: { origin: M2_TEST_ORIGIN, cookie: nanny.cookie },
        payload: { expectedVersion: 1 },
      });
      expect([staleEdit.statusCode, staleUndo.statusCode]).toEqual([409, 409]);
      expect(staleEdit.json()).toMatchObject({ code: 'care_state_conflict' });
      expect(staleUndo.json()).toMatchObject({ code: 'care_state_conflict' });

      const stored = await context.database.pool.query<{
        version: number;
        status: string;
        occurred_at: Date;
        kind: string;
      }>(
        `select ce.version, ce.status, ce.occurred_at, de.kind
           from care_events ce join diaper_events de on de.event_id = ce.id
          where ce.id = $1`,
        [eventId],
      );
      expect(stored.rows[0]).toMatchObject({ version: 2, status: 'active', kind: 'stool' });
      expect(stored.rows[0]!.occurred_at.toISOString()).toBe('2026-08-13T07:41:00.000Z');
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('returns scoped typed history with factual actors and chronological versions without deleting care facts', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const dadSession = await context.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: context.cookie } });
      const dad = dadSession.json() as CareActorContext & { displayName: string };
      const nanny = await createNanny(context);
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/care/diapers',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          occurredAt: '2026-08-13T07:40:00.000Z',
          clientRequestId: randomUUID(),
          kind: 'urine',
        },
      });
      const eventId = created.json().id as string;
      const original = await context.database.pool.query<{
        actor_user_id: string;
        actor_membership_id: string;
        source: string;
      }>('select actor_user_id, actor_membership_id, source from care_events where id = $1', [eventId]);

      const edited = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          expectedVersion: 1,
          event: {
            eventType: 'diaper',
            occurredAt: '2026-08-13T07:41:00.000Z',
            kind: 'stool',
            stoolColor: 'yellow',
          },
        },
      });
      expect(edited.statusCode).toBe(200);
      const undone = await context.app.inject({
        method: 'POST',
        url: `/api/care/events/${eventId}/undo`,
        headers: { origin: M2_TEST_ORIGIN, cookie: nanny.cookie },
        payload: { expectedVersion: 2 },
      });
      expect(undone.statusCode).toBe(200);

      const staleAfterVoid = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          expectedVersion: 2,
          event: {
            eventType: 'diaper',
            occurredAt: '2026-08-13T07:42:00.000Z',
            kind: 'urine',
          },
        },
      });
      expect(staleAfterVoid.statusCode).toBe(409);
      expect(staleAfterVoid.json()).toMatchObject({ code: 'care_state_conflict' });

      const response = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${eventId}/revisions`,
        headers: { cookie: context.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          id: expect.any(String),
          eventId,
          action: 'edit',
          actorUserId: dad.userId,
          actorDisplayName: 'Dad',
          createdAt: expect.any(String),
          fromVersion: 1,
          toVersion: 2,
          before: {
            eventType: 'diaper',
            occurredAt: '2026-08-13T07:40:00.000Z',
            kind: 'urine',
          },
          after: {
            eventType: 'diaper',
            occurredAt: '2026-08-13T07:41:00.000Z',
            kind: 'stool',
            stoolColor: 'yellow',
          },
        },
        {
          id: expect.any(String),
          eventId,
          action: 'void',
          actorUserId: nanny.actor.userId,
          actorDisplayName: 'Nanny',
          createdAt: expect.any(String),
          fromVersion: 2,
          toVersion: 3,
          before: {
            eventType: 'diaper',
            occurredAt: '2026-08-13T07:41:00.000Z',
            kind: 'stool',
            stoolColor: 'yellow',
          },
          after: { status: 'voided' },
        },
      ]);

      const persisted = await context.database.pool.query<{
        actor_user_id: string;
        actor_membership_id: string;
        source: string;
        status: string;
        version: number;
        diaper_count: number;
      }>(
        `select ce.actor_user_id, ce.actor_membership_id, ce.source, ce.status, ce.version,
                count(de.event_id)::int as diaper_count
           from care_events ce left join diaper_events de on de.event_id = ce.id
          where ce.id = $1
          group by ce.id`,
        [eventId],
      );
      expect(persisted.rows[0]).toEqual({
        ...original.rows[0],
        status: 'voided',
        version: 3,
        diaper_count: 1,
      });

      const foreignActor = { ...dad, familyId: randomUUID() };
      expect(await createRevisionQueryService(context.database).list(foreignActor, eventId)).toEqual([]);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('projects the existing sleep completion revision as typed history', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const started = await context.app.inject({
        method: 'POST',
        url: '/api/care/sleep/start',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          occurredAt: '2026-08-13T07:20:00.000Z',
          clientRequestId: randomUUID(),
          note: 'bassinet',
        },
      });
      expect(started.statusCode).toBe(201);
      const eventId = started.json().id as string;
      const woke = await context.app.inject({
        method: 'POST',
        url: '/api/care/sleep/wake',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:40:00.000Z', clientRequestId: randomUUID() },
      });
      expect(woke.statusCode).toBe(200);

      const history = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${eventId}/revisions`,
        headers: { cookie: context.cookie },
      });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual([
        expect.objectContaining({
          eventId,
          action: 'edit',
          fromVersion: 1,
          toVersion: 2,
          before: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: null,
            note: 'bassinet',
          },
          after: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: '2026-08-13T07:40:00.000Z',
            note: 'bassinet',
          },
        }),
      ]);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
