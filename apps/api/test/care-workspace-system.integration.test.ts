import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CareHandoffBriefingDtoSchema } from '@baby-care/contracts';
import { createSessionToken } from '../src/auth/session-token.js';
import type { CareActorContext } from '../src/care/care-auth.js';
import { encodeTimelineCursor } from '../src/care/timeline-cursor.js';
import { registerCareRevisionRoutes } from '../src/routes/care-revisions.js';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const cookie = header.split(';', 1)[0];
  if (!cookie) throw new Error('expected session cookie pair');
  return cookie;
}

function careHeaders(cookie: string, traceId?: string) {
  return { origin: M2_TEST_ORIGIN, cookie, ...(traceId ? { 'x-trace-id': traceId } : {}) };
}

async function createNanny(context: TestContext) {
  const created = await context.app.inject({
    method: 'POST',
    url: '/api/family/members',
    headers: careHeaders(context.cookie),
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
    membershipId: created.json().membershipId as string,
  };
}

async function postCare(
  context: TestContext,
  cookie: string,
  url: string,
  payload: Record<string, unknown>,
) {
  const response = await context.app.inject({
    method: 'POST',
    url,
    headers: careHeaders(cookie),
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response;
}

async function createCheckpoint(context: TestContext, cookie: string, occurredAt: string) {
  return postCare(context, cookie, '/api/care/handoffs', {
    occurredAt,
    clientRequestId: randomUUID(),
  });
}

async function checkpointCount(context: TestContext): Promise<number> {
  const result = await context.database.pool.query<{ count: number }>(
    'select count(*)::int as count from care_handoff_checkpoints',
  );
  return result.rows[0]?.count ?? 0;
}

function withoutTraceId(response: { json(): unknown }): unknown {
  const stable = { ...(response.json() as Record<string, unknown>) };
  delete stable.traceId;
  return stable;
}

async function createForeignFamilySession(context: TestContext) {
  const familyId = randomUUID();
  const babyId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const sessionId = randomUUID();
  const token = createSessionToken();
  const client = await context.database.pool.connect();
  try {
    await client.query('begin');
    await client.query('drop index families_single_active_idx');
    await client.query(
      `insert into families (id, name, timezone) values ($1, 'Foreign Family', 'UTC')`,
      [familyId],
    );
    await client.query(
      `insert into babies (id, family_id, display_name) values ($1, $2, 'Foreign Baby')`,
      [babyId, familyId],
    );
    await client.query(
      `insert into users (id, login_name, display_name, password_hash)
       values ($1, $2, 'Foreign Dad', 'not-used')`,
      [userId, `foreign-dad-${userId}`],
    );
    await client.query(
      `insert into family_memberships (
         id, family_id, user_id, relationship, permission_level
       ) values ($1, $2, $3, 'dad', 'family_admin')`,
      [membershipId, familyId, userId],
    );
    await client.query(
      `insert into sessions (
         id, family_id, user_id, token_hash, created_at, expires_at, last_seen_at
       ) values ($1, $2, $3, $4, '2026-08-13T07:00:00.000Z', '2026-09-13T07:00:00.000Z', '2026-08-13T07:00:00.000Z')`,
      [sessionId, familyId, userId, token.hash],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return {
    cookie: `baby_care_session=${encodeURIComponent(token.raw)}`,
    async cleanup() {
      const cleanup = await context.database.pool.connect();
      try {
        await cleanup.query('begin');
        await cleanup.query('delete from audit_events where family_id = $1', [familyId]);
        await cleanup.query('delete from sessions where family_id = $1', [familyId]);
        await cleanup.query('delete from babies where family_id = $1', [familyId]);
        await cleanup.query('delete from family_memberships where family_id = $1', [familyId]);
        await cleanup.query('delete from users where id = $1', [userId]);
        await cleanup.query('delete from families where id = $1', [familyId]);
        await cleanup.query(
          `create unique index families_single_active_idx on families using btree ((1))
           where status = 'active'`,
        );
        await cleanup.query('commit');
      } catch (error) {
        await cleanup.query('rollback');
        throw error;
      } finally {
        cleanup.release();
      }
    },
  };
}

describe('M3 workspace denial contract', () => {
  it('returns the same non-leaking not-found response when revision history is outside the actor scope', async () => {
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
        edit: async () => {
          throw new Error('not used');
        },
        undo: async () => {
          throw new Error('not used');
        },
      } as never,
      revisionQueryService: { list: async () => null } as never,
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/care/events/55555555-5555-4555-8555-555555555555/revisions',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        code: 'care_event_not_found',
        message: 'Care event was not found.',
      });
    } finally {
      await app.close();
    }
  });
});

describeDatabase('M3 cross-caregiver workspace closure', () => {
  it('keeps a corrected fixed briefing factual across Dad and Nanny takeover with stale undo rejected', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const nanny = await createNanny(context);
      await createCheckpoint(context, context.cookie, '2026-08-13T07:00:00.000Z');

      const feeding = await postCare(context, context.cookie, '/api/care/feeding-sessions', {
        occurredAt: '2026-08-13T07:10:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
      });
      const feedingId = feeding.json().id as string;
      await postCare(context, nanny.cookie, '/api/care/diapers', {
        occurredAt: '2026-08-13T07:20:00.000Z',
        clientRequestId: randomUUID(),
        kind: 'urine_stool',
        stoolColor: 'yellow',
      });
      await postCare(context, nanny.cookie, '/api/care/actions', {
        occurredAt: '2026-08-13T07:30:00.000Z',
        clientRequestId: randomUUID(),
        action: { kind: 'medication', medicationName: 'Recorded medicine', dose: 1.25, doseUnit: 'mL' },
      });

      const dadBriefingResponse = await createCheckpoint(context, context.cookie, '2026-08-13T07:40:00.000Z');
      const dadBriefing = CareHandoffBriefingDtoSchema.parse(dadBriefingResponse.json());
      expect(dadBriefing.window).toEqual({
        mode: 'checkpoint',
        from: '2026-08-13T07:00:00.000Z',
        to: '2026-08-13T07:40:00.000Z',
      });
      expect(dadBriefing.feeding).toMatchObject({ bottleTotalMl: 60, formulaMl: 60 });
      expect(dadBriefing.diapers).toEqual({ urine: 0, stool: 0, urineStool: 1 });
      expect(dadBriefing.actorActivity).toEqual([
        { actorUserId: expect.any(String), actorDisplayName: 'Nanny', eventCount: 2 },
        { actorUserId: expect.any(String), actorDisplayName: 'Dad', eventCount: 1 },
      ]);
      expect(dadBriefing.notableEvents).toContainEqual(expect.objectContaining({
        eventType: 'feeding',
        actorDisplayName: 'Dad',
        payload: {
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
          relatedActions: [],
        },
      }));
      expect(dadBriefing.notableEvents).toContainEqual(expect.objectContaining({
        eventType: 'medication',
        actorDisplayName: 'Nanny',
        payload: {
          action: { kind: 'medication', medicationName: 'Recorded medicine', dose: 1.25, doseUnit: 'mL' },
        },
      }));

      const edited = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${feedingId}`,
        headers: careHeaders(context.cookie),
        payload: {
          expectedVersion: 1,
          event: {
            eventType: 'feeding',
            occurredAt: '2026-08-13T07:10:00.000Z',
            components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 }],
          },
        },
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({ id: feedingId, version: 2, status: 'active' });

      const reopenedResponse = await context.app.inject({
        method: 'GET',
        url: `/api/care/handoffs/${dadBriefing.checkpoint.id}/summary`,
        headers: { cookie: context.cookie },
      });
      expect(reopenedResponse.statusCode).toBe(200);
      const reopened = CareHandoffBriefingDtoSchema.parse(reopenedResponse.json());
      expect(reopened.window).toEqual(dadBriefing.window);
      expect(reopened.feeding).toMatchObject({ bottleTotalMl: 65, formulaMl: 65 });
      expect(reopened.corrections).toContainEqual(expect.objectContaining({
        eventId: feedingId,
        action: 'edit',
        actorDisplayName: 'Dad',
      }));

      const nannyTakeover = await createCheckpoint(context, nanny.cookie, '2026-08-13T08:00:00.000Z');
      expect(nannyTakeover.json()).toMatchObject({
        checkpoint: { actorDisplayName: 'Nanny' },
        previousCheckpoint: { id: dadBriefing.checkpoint.id, actorDisplayName: 'Dad' },
      });
      const nannyReopened = await context.app.inject({
        method: 'GET',
        url: `/api/care/handoffs/${dadBriefing.checkpoint.id}/summary`,
        headers: { cookie: nanny.cookie },
      });
      expect(nannyReopened.statusCode).toBe(200);
      expect(nannyReopened.json()).toMatchObject({
        window: dadBriefing.window,
        feeding: { bottleTotalMl: 65, formulaMl: 65 },
      });

      const staleUndo = await context.app.inject({
        method: 'POST',
        url: `/api/care/events/${feedingId}/undo`,
        headers: careHeaders(context.cookie),
        payload: { expectedVersion: 1 },
      });
      expect(staleUndo.statusCode).toBe(409);
      expect(staleUndo.json()).toMatchObject({ code: 'care_state_conflict' });
      const detail = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${feedingId}`,
        headers: { cookie: nanny.cookie },
      });
      expect(detail.json()).toMatchObject({ id: feedingId, version: 2, status: 'active' });
      const history = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${feedingId}/revisions`,
        headers: { cookie: nanny.cookie },
      });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toEqual([
        expect.objectContaining({ eventId: feedingId, action: 'edit', fromVersion: 1, toVersion: 2 }),
      ]);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('makes foreign and missing IDs indistinguishable and never crosses timeline family scope', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    let foreign: Awaited<ReturnType<typeof createForeignFamilySession>> | undefined;
    try {
      const checkpoint = await createCheckpoint(context, context.cookie, '2026-08-13T07:00:00.000Z');
      const feeding = await postCare(context, context.cookie, '/api/care/feeding-sessions', {
        occurredAt: '2026-08-13T07:10:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
      });
      const feedingId = feeding.json().id as string;
      const bathing = await postCare(context, context.cookie, '/api/care/actions', {
        occurredAt: '2026-08-13T07:20:00.000Z',
        clientRequestId: randomUUID(),
        action: { kind: 'bathing' },
      });
      const bathingId = bathing.json().id as string;
      const edited = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${feedingId}`,
        headers: careHeaders(context.cookie),
        payload: {
          expectedVersion: 1,
          event: {
            eventType: 'feeding',
            occurredAt: '2026-08-13T07:10:00.000Z',
            components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 }],
          },
        },
      });
      expect(edited.statusCode).toBe(200);

      const localTimeline = await context.app.inject({
        method: 'GET',
        url: '/api/care/timeline?from=2026-08-13T07%3A00%3A00.000Z&to=2026-08-13T08%3A00%3A00.000Z&limit=1',
        headers: { cookie: context.cookie },
      });
      expect(localTimeline.statusCode).toBe(200);
      expect(localTimeline.json()).toMatchObject({
        items: [expect.objectContaining({ id: bathingId })],
        nextCursor: expect.any(String),
      });
      const authorizedEmptyHistory = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${bathingId}/revisions`,
        headers: { cookie: context.cookie },
      });
      expect(authorizedEmptyHistory.statusCode).toBe(200);
      expect(authorizedEmptyHistory.json()).toEqual([]);

      foreign = await createForeignFamilySession(context);
      const missingId = randomUUID();
      const [foreignCheckpoint, missingCheckpoint, foreignDetail, missingDetail, foreignHistory, missingHistory] =
        await Promise.all([
          context.app.inject({
            method: 'GET',
            url: `/api/care/handoffs/${checkpoint.json().checkpoint.id}/summary`,
            headers: { cookie: foreign.cookie },
          }),
          context.app.inject({
            method: 'GET',
            url: `/api/care/handoffs/${missingId}/summary`,
            headers: { cookie: foreign.cookie },
          }),
          context.app.inject({
            method: 'GET',
            url: `/api/care/events/${feedingId}`,
            headers: { cookie: foreign.cookie },
          }),
          context.app.inject({
            method: 'GET',
            url: `/api/care/events/${missingId}`,
            headers: { cookie: foreign.cookie },
          }),
          context.app.inject({
            method: 'GET',
            url: `/api/care/events/${feedingId}/revisions`,
            headers: { cookie: foreign.cookie },
          }),
          context.app.inject({
            method: 'GET',
            url: `/api/care/events/${missingId}/revisions`,
            headers: { cookie: foreign.cookie },
          }),
        ]);

      for (const response of [foreignCheckpoint, missingCheckpoint, foreignDetail, missingDetail, foreignHistory, missingHistory]) {
        expect(response.statusCode).toBe(404);
      }
      expect(withoutTraceId(foreignCheckpoint)).toEqual(withoutTraceId(missingCheckpoint));
      expect(withoutTraceId(foreignDetail)).toEqual(withoutTraceId(missingDetail));
      expect(withoutTraceId(foreignHistory)).toEqual(withoutTraceId(missingHistory));

      const localCursor = localTimeline.json().nextCursor as string;
      const missingCursor = encodeTimelineCursor({
        occurredAt: '2026-08-13T07:20:00.000Z',
        createdAt: '2026-08-13T07:20:00.000Z',
        id: missingId,
      });
      const [foreignWindow, foreignCursor, missingCursorPage] = await Promise.all([
        context.app.inject({
          method: 'GET',
          url: '/api/care/timeline?from=2026-08-13T07%3A00%3A00.000Z&to=2026-08-13T08%3A00%3A00.000Z',
          headers: { cookie: foreign.cookie },
        }),
        context.app.inject({
          method: 'GET',
          url: `/api/care/timeline?cursor=${encodeURIComponent(localCursor)}&limit=1`,
          headers: { cookie: foreign.cookie },
        }),
        context.app.inject({
          method: 'GET',
          url: `/api/care/timeline?cursor=${encodeURIComponent(missingCursor)}&limit=1`,
          headers: { cookie: foreign.cookie },
        }),
      ]);
      expect(foreignWindow.json()).toEqual({ items: [], nextCursor: null });
      expect(foreignCursor.json()).toEqual({ items: [], nextCursor: null });
      expect(missingCursorPage.json()).toEqual(foreignCursor.json());
      const foreignReads = JSON.stringify([
        foreignWindow.json(),
        foreignCursor.json(),
        missingCursorPage.json(),
      ]);
      expect(foreignReads).not.toContain(feedingId);
      expect(foreignReads).not.toContain(bathingId);
      expect(foreignReads).not.toContain('formula');
    } finally {
      await foreign?.cleanup();
      await context.app.close();
      await context.database.close();
    }
  });

  it('keeps reminder configuration separate from authoritative checkpoint facts', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const nanny = await createNanny(context);
      await createCheckpoint(context, context.cookie, '2026-08-13T07:00:00.000Z');
      const expectedCount = await checkpointCount(context);

      const dadWrite = await context.app.inject({
        method: 'PUT',
        url: '/api/care/handoff-reminders',
        headers: careHeaders(context.cookie),
        payload: { rules: [{ localTime: '16:00', weekdays: [4], enabled: true }] },
      });
      expect(dadWrite.statusCode).toBe(200);
      expect(await checkpointCount(context)).toBe(expectedCount);
      const nannyWrite = await context.app.inject({
        method: 'PUT',
        url: '/api/care/handoff-reminders',
        headers: careHeaders(nanny.cookie),
        payload: { rules: [{ localTime: '17:00', weekdays: [4], enabled: true }] },
      });
      expect(nannyWrite.statusCode).toBe(200);
      expect(await checkpointCount(context)).toBe(expectedCount);

      const [dadRead, nannyRead] = await Promise.all([
        context.app.inject({ method: 'GET', url: '/api/care/handoff-reminders', headers: { cookie: context.cookie } }),
        context.app.inject({ method: 'GET', url: '/api/care/handoff-reminders', headers: { cookie: nanny.cookie } }),
      ]);
      expect(dadRead.json().rules).toEqual([{ localTime: '16:00', weekdays: [4], enabled: true }]);
      expect(nannyRead.json().rules).toEqual([{ localTime: '17:00', weekdays: [4], enabled: true }]);
      expect(await checkpointCount(context)).toBe(expectedCount);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
