import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { CareActorContext } from '../src/care/care-auth.js';
import { createSleepService } from '../src/care/sleep-service.js';
import type { DatabaseContext } from '../src/db.js';
import {
  createRevisionQueryService,
  normalizeRevisionEditSnapshot,
} from '../src/care/revision-query-service.js';
import { registerCareRevisionRoutes } from '../src/routes/care-revisions.js';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describe('M3 revision route contracts', () => {
  it('rejects edit and undo requests that omit their expected version wrappers', async () => {
    const app = Fastify();
    const actor: CareActorContext = {
      familyId: '11111111-1111-4111-8111-111111111111',
      babyId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      membershipId: '44444444-4444-4444-8444-444444444444',
      relationship: 'dad',
      permissionLevel: 'family_admin',
    };
    registerCareRevisionRoutes(app, {
      careAuth: {
        requireRead: async () => actor,
        requireWrite: async () => actor,
      } as never,
      revisionService: {
        edit: async () => ({
          id: '55555555-5555-4555-8555-555555555555',
          eventType: 'diaper',
          status: 'active',
          version: 2,
        }),
        undo: async () => ({ id: '55555555-5555-4555-8555-555555555555', status: 'voided' }),
      } as never,
      revisionQueryService: { list: async () => [] },
    });

    try {
      const eventId = '55555555-5555-4555-8555-555555555555';
      const bareEdit = await app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        payload: {
          eventType: 'diaper',
          occurredAt: '2026-08-13T07:40:00.000Z',
          kind: 'urine',
        },
      });
      const bodylessUndo = await app.inject({ method: 'POST', url: `/api/care/events/${eventId}/undo` });

      expect(bareEdit.statusCode).toBe(400);
      expect(bodylessUndo.statusCode).toBe(400);
      expect(bareEdit.json()).toMatchObject({ code: 'validation_failed' });
      expect(bodylessUndo.json()).toMatchObject({ code: 'validation_failed' });
    } finally {
      await app.close();
    }
  });

  it('does not invent a legacy sleep note from the current event envelope', () => {
    expect(normalizeRevisionEditSnapshot(
      { startedAt: '2026-08-13T07:20:00.000Z', endedAt: null },
      'sleep',
    )).toEqual({
      eventType: 'sleep',
      startedAt: '2026-08-13T07:20:00.000Z',
      endedAt: null,
    });
  });

  it('returns the wake receipt captured under lock rather than a later reloaded state', async () => {
    const eventId = '55555555-5555-4555-8555-555555555555';
    const actor: CareActorContext = {
      familyId: '11111111-1111-4111-8111-111111111111',
      babyId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      membershipId: '44444444-4444-4444-8444-444444444444',
      relationship: 'dad',
      permissionLevel: 'family_admin',
    };
    const startedAt = new Date('2026-08-13T07:20:00.000Z');
    const lockedEventRow = {
      id: eventId,
      family_id: actor.familyId,
      baby_id: actor.babyId,
      actor_user_id: actor.userId,
      actor_membership_id: actor.membershipId,
      source: 'manual',
      event_type: 'sleep',
      occurred_at: startedAt,
      created_at: startedAt,
      updated_at: startedAt,
      status: 'active',
      version: 1,
      client_request_id: randomUUID(),
      note: 'bassinet',
      trace_id: 'start-trace',
    };
    let poolReads = 0;
    const client = {
      query: async (sql: string) => {
        if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [] };
        if (sql.includes('from care_events') && sql.includes('for update')) return { rows: [lockedEventRow] };
        if (sql.includes('from sleep_intervals') && sql.includes('for update')) {
          return { rows: [{ started_at: startedAt, ended_at: null }] };
        }
        if (sql.includes('insert into care_event_revisions')) return { rows: [{ id: randomUUID() }] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const database = {
      pool: {
        connect: async () => client,
        query: async () => {
          poolReads += 1;
          return poolReads === 1
            ? { rows: [{ ...lockedEventRow, started_at: startedAt, ended_at: null }] }
            : { rows: [{
              ...lockedEventRow,
              version: 9,
              note: 'later correction',
              started_at: startedAt,
              ended_at: new Date('2026-08-13T07:45:00.000Z'),
            }] };
        },
      },
    } as unknown as DatabaseContext;

    const result = await createSleepService(
      database,
      () => new Date('2026-08-13T08:00:00.000Z'),
    ).wake(actor, {
      occurredAt: '2026-08-13T07:40:00.000Z',
      clientRequestId: randomUUID(),
    }, 'wake-trace');

    expect(result).toMatchObject({
      id: eventId,
      version: 2,
      note: 'bassinet',
      endedAt: '2026-08-13T07:40:00.000Z',
    });
  });
});

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected session cookie pair');
  return pair;
}

async function waitForBlockedCareConnections(database: DatabaseContext, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await database.pool.query<{ count: number }>(
      `select count(*)::int as count
         from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and (query like '%care_events%' or query like '%sleep_intervals%')`,
    );
    if ((waiting.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${expected} blocked care transaction(s)`);
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
      const revisionCount = await context.database.pool.query<{ count: number }>(
        'select count(*)::int as count from care_event_revisions where event_id = $1',
        [eventId],
      );
      expect(revisionCount.rows[0]?.count).toBe(1);
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

      await context.database.pool.query(
        `update care_event_revisions
            set created_at = '2026-08-13T08:00:00.000Z',
                id = case revision_action
                  when 'edit' then 'ffffffff-ffff-4fff-bfff-ffffffffffff'::uuid
                  else '00000000-0000-4000-8000-000000000001'::uuid
                end
          where event_id = $1`,
        [eventId],
      );

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

  it('allows only one concurrent correction for the same expected version', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    const blocker = await context.database.pool.connect();
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
      const eventId = created.json().id as string;
      await blocker.query('begin');
      await blocker.query('select id from care_events where id = $1 for update', [eventId]);
      const edit = (cookie: string, kind: 'stool' | 'urine_stool') => context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie },
        payload: {
          expectedVersion: 1,
          event: {
            eventType: 'diaper',
            occurredAt: '2026-08-13T07:41:00.000Z',
            kind,
          },
        },
      });

      const pendingResponses = [edit(context.cookie, 'stool'), edit(nanny.cookie, 'urine_stool')];
      await waitForBlockedCareConnections(context.database, 2);
      await blocker.query('commit');
      const responses = await Promise.all(pendingResponses);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      expect(responses.find((response) => response.statusCode === 409)?.json()).toMatchObject({
        code: 'care_state_conflict',
      });
      const state = await context.database.pool.query<{ version: number; revisions: number }>(
        `select ce.version, count(cr.id)::int as revisions
           from care_events ce left join care_event_revisions cr on cr.event_id = ce.id
          where ce.id = $1 group by ce.id`,
        [eventId],
      );
      expect(state.rows[0]).toEqual({ version: 2, revisions: 1 });
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await context.app.close();
      await context.database.close();
    }
  });

  it('derives wake history and its receipt version from the locked current sleep state', async () => {
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
      const openSleepCorrection = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          expectedVersion: 1,
          event: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: null,
            note: 'nursery',
          },
        },
      });
      expect(openSleepCorrection.statusCode).toBe(200);
      const woke = await context.app.inject({
        method: 'POST',
        url: '/api/care/sleep/wake',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:40:00.000Z', clientRequestId: randomUUID() },
      });
      expect(woke.statusCode).toBe(200);
      expect(woke.json().version).toBe(3);

      const corrected = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          expectedVersion: 3,
          event: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: '2026-08-13T07:40:00.000Z',
            note: 'crib',
          },
        },
      });
      expect(corrected.statusCode).toBe(200);

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
            endedAt: null,
            note: 'nursery',
          },
        }),
        expect.objectContaining({
          eventId,
          action: 'edit',
          fromVersion: 2,
          toVersion: 3,
          before: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: null,
            note: 'nursery',
          },
          after: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: '2026-08-13T07:40:00.000Z',
            note: 'nursery',
          },
        }),
        expect.objectContaining({
          eventId,
          action: 'edit',
          fromVersion: 3,
          toVersion: 4,
          before: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: '2026-08-13T07:40:00.000Z',
            note: 'nursery',
          },
          after: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: '2026-08-13T07:40:00.000Z',
            note: 'crib',
          },
        }),
      ]);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('serializes wake with a concurrent correction instead of emitting duplicate revision versions', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    const blocker = await context.database.pool.connect();
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
      const eventId = started.json().id as string;
      await blocker.query('begin');
      await blocker.query('select event_id from sleep_intervals where event_id = $1 for update', [eventId]);

      const wake = context.app.inject({
        method: 'POST',
        url: '/api/care/sleep/wake',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { occurredAt: '2026-08-13T07:40:00.000Z', clientRequestId: randomUUID() },
      });

      await waitForBlockedCareConnections(context.database, 1);
      const correction = context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          expectedVersion: 1,
          event: {
            eventType: 'sleep',
            startedAt: '2026-08-13T07:20:00.000Z',
            endedAt: null,
            note: 'nursery',
          },
        },
      });
      await waitForBlockedCareConnections(context.database, 2);
      await blocker.query('commit');

      const results = await Promise.all([wake, correction]);
      expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      expect(results.find((response) => response.statusCode === 409)?.json()).toMatchObject({
        code: 'care_state_conflict',
      });
      const revisions = await context.database.pool.query<{
        version: number;
        from_version: number;
        to_version: number;
      }>(
        `select ce.version, cr.from_version, cr.to_version
           from care_events ce
           join care_event_revisions cr on cr.event_id = ce.id
          where ce.id = $1`,
        [eventId],
      );
      expect(revisions.rows).toEqual([{ version: 2, from_version: 1, to_version: 2 }]);
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await context.app.close();
      await context.database.close();
    }
  });
});
