import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { CareTimelineItemDtoSchema, CareTimelineResponseSchema } from '@baby-care/contracts';
import type { CareActorContext } from '../src/care/care-auth.js';
import { createQueryService } from '../src/care/query-service.js';
import { decodeTimelineCursor, encodeTimelineCursor } from '../src/care/timeline-cursor.js';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const occurredAt = '2026-08-13T07:50:00.000Z';

type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  return header.split(';', 1)[0]!;
}

async function createNanny(context: TestContext): Promise<string> {
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
  return cookieFrom(login as unknown as { headers: Record<string, unknown> });
}

async function createTimelineFixture(context: TestContext) {
  const nannyCookie = await createNanny(context);
  const feeding = await context.app.inject({
    method: 'POST',
    url: '/api/care/feeding-sessions',
    headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
    payload: {
      occurredAt,
      clientRequestId: randomUUID(),
      note: 'Dad feed',
      components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 }],
    },
  });
  expect(feeding.statusCode).toBe(201);

  const diaper = await context.app.inject({
    method: 'POST',
    url: '/api/care/diapers',
    headers: { origin: M2_TEST_ORIGIN, cookie: nannyCookie },
    payload: {
      occurredAt,
      clientRequestId: randomUUID(),
      kind: 'stool',
      stoolColor: 'yellow',
      stoolConsistency: 'seedy',
      stoolAmount: 'medium',
    },
  });
  expect(diaper.statusCode).toBe(201);

  const bathing = await context.app.inject({
    method: 'POST',
    url: '/api/care/actions',
    headers: { origin: M2_TEST_ORIGIN, cookie: nannyCookie },
    payload: { occurredAt, clientRequestId: randomUUID(), action: { kind: 'bathing' } },
  });
  expect(bathing.statusCode).toBe(201);

  const ids = {
    feeding: feeding.json().id as string,
    diaper: diaper.json().id as string,
    bathing: bathing.json().id as string,
  };
  await context.database.pool.query(
    `update care_events
        set created_at = case id
          when $1 then '2026-08-13T07:55:00.000Z'::timestamptz
          when $2 then '2026-08-13T07:55:00.001Z'::timestamptz
          when $3 then '2026-08-13T07:56:00.000Z'::timestamptz
        end,
            updated_at = case id
          when $1 then '2026-08-13T07:55:00.000Z'::timestamptz
          when $2 then '2026-08-13T07:55:00.001Z'::timestamptz
          when $3 then '2026-08-13T07:56:00.000Z'::timestamptz
        end
      where id = any($4::uuid[])`,
    [ids.feeding, ids.diaper, ids.bathing, Object.values(ids)],
  );
  return ids;
}

describe('timeline cursor codec', () => {
  it('fails if cursor serialization stops preserving the complete stable ordering tuple', () => {
    const value = {
      occurredAt: '2026-08-13T07:50:00.000Z',
      createdAt: '2026-08-13T07:55:00.001Z',
      id: '00000000-0000-4000-8000-000000000001',
    };
    const encoded = encodeTimelineCursor(value);

    expect(encoded).not.toContain(value.occurredAt);
    expect(decodeTimelineCursor(encoded)).toEqual(value);
  });

  it('fails if malformed or obsolete cursor versions are accepted', () => {
    const obsolete = Buffer.from(JSON.stringify({
      version: 0,
      occurredAt: '2026-08-13T07:50:00.000Z',
      createdAt: '2026-08-13T07:55:00.001Z',
      id: '00000000-0000-4000-8000-000000000001',
    })).toString('base64url');
    const valid = encodeTimelineCursor({
      occurredAt: '2026-08-13T07:50:00.000Z',
      createdAt: '2026-08-13T07:55:00.001Z',
      id: '00000000-0000-4000-8000-000000000001',
    });

    expect(() => decodeTimelineCursor('not-a-cursor')).toThrow('Invalid timeline cursor.');
    expect(() => decodeTimelineCursor(obsolete)).toThrow('Invalid timeline cursor.');
    expect(() => decodeTimelineCursor(`${valid}!`)).toThrow('Invalid timeline cursor.');
  });
});

describeDatabase('M3 care workspace timeline and detail', () => {
  it('fails if typed payloads, attribution, versions, or the five-minute boundary are projected incorrectly', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const ids = await createTimelineFixture(context);
      const response = await context.app.inject({
        method: 'GET',
        url: '/api/care/timeline?limit=20',
        headers: { cookie: context.cookie },
      });

      expect(response.statusCode).toBe(200);
      const body = CareTimelineResponseSchema.parse(response.json());
      expect(body.items.map((item) => item.id)).toEqual([ids.bathing, ids.diaper, ids.feeding]);
      expect(body.items).toEqual([
        expect.objectContaining({
          id: ids.bathing,
          eventType: 'bathing',
          actorDisplayName: 'Nanny',
          source: 'manual',
          version: 1,
          isBackfilled: true,
          payload: { action: { kind: 'bathing' } },
        }),
        expect.objectContaining({
          id: ids.diaper,
          eventType: 'diaper',
          actorDisplayName: 'Nanny',
          source: 'manual',
          version: 1,
          isBackfilled: true,
          payload: {
            kind: 'stool',
            stoolColor: 'yellow',
            stoolConsistency: 'seedy',
            stoolAmount: 'medium',
          },
        }),
        expect.objectContaining({
          id: ids.feeding,
          eventType: 'feeding',
          actorDisplayName: 'Dad',
          source: 'manual',
          version: 1,
          isBackfilled: false,
          payload: {
            components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 65, bottleCapacityMl: 150 }],
            relatedActions: [],
          },
        }),
      ]);
      expect(body.nextCursor).toBeNull();
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('fails if category, inclusive range, bare, or legacy-before timeline modes regress', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const ids = await createTimelineFixture(context);
      const requests = await Promise.all([
        context.app.inject({ method: 'GET', url: '/api/care/timeline', headers: { cookie: context.cookie } }),
        context.app.inject({
          method: 'GET',
          url: `/api/care/timeline?before=${encodeURIComponent(occurredAt)}&limit=20`,
          headers: { cookie: context.cookie },
        }),
        context.app.inject({
          method: 'GET',
          url: `/api/care/timeline?category=feeding&from=${encodeURIComponent(occurredAt)}&to=${encodeURIComponent(occurredAt)}`,
          headers: { cookie: context.cookie },
        }),
        context.app.inject({ method: 'GET', url: '/api/care/timeline?category=other', headers: { cookie: context.cookie } }),
      ]);

      expect(requests.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
      expect(requests[0]!.json().items).toHaveLength(3);
      expect(requests[1]!.json().items).toHaveLength(3);
      expect(requests[2]!.json().items.map((item: { id: string }) => item.id)).toEqual([ids.feeding]);
      expect(requests[3]!.json().items.map((item: { id: string }) => item.id)).toEqual([ids.bathing]);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('fails if equal-time cursor pages overlap, omit records, or use a non-strict tuple comparison', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const ids = await createTimelineFixture(context);
      await context.database.pool.query(
        `update care_events
            set created_at = '2026-08-13T07:55:00.000Z', updated_at = '2026-08-13T07:55:00.000Z'
          where id = any($1::uuid[])`,
        [Object.values(ids)],
      );
      const expectedOrder = Object.values(ids).sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
      const firstResponse = await context.app.inject({
        method: 'GET',
        url: '/api/care/timeline?limit=2',
        headers: { cookie: context.cookie },
      });
      expect(firstResponse.statusCode).toBe(200);
      const firstPage = CareTimelineResponseSchema.parse(firstResponse.json());
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      const secondResponse = await context.app.inject({
        method: 'GET',
        url: `/api/care/timeline?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
        headers: { cookie: context.cookie },
      });
      expect(secondResponse.statusCode).toBe(200);
      const secondPage = CareTimelineResponseSchema.parse(secondResponse.json());

      const firstIds = new Set(firstPage.items.map((item) => item.id));
      expect(secondPage.items.some((item) => firstIds.has(item.id))).toBe(false);
      expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(expectedOrder);
      expect(secondPage.nextCursor).toBeNull();
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('fails if malformed or obsolete cursors do not return the same restartable validation response', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const obsolete = Buffer.from(JSON.stringify({ version: 0 })).toString('base64url');
      for (const cursor of ['not-a-cursor', obsolete]) {
        const response = await context.app.inject({
          method: 'GET',
          url: `/api/care/timeline?cursor=${encodeURIComponent(cursor)}`,
          headers: { cookie: context.cookie },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          code: 'validation_failed',
          message: 'Invalid timeline cursor.',
          traceId: expect.any(String),
        });
      }
      const restart = await context.app.inject({
        method: 'GET',
        url: '/api/care/timeline?limit=20',
        headers: { cookie: context.cookie },
      });
      expect(restart.statusCode).toBe(200);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('fails if active timeline policy hides authorized voided detail or detail leaks another family', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const ids = await createTimelineFixture(context);
      await context.database.pool.query(`update care_events set status = 'voided', version = 2 where id = $1`, [ids.bathing]);

      const detail = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${ids.bathing}`,
        headers: { cookie: context.cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(CareTimelineItemDtoSchema.parse(detail.json())).toMatchObject({ id: ids.bathing, status: 'voided', version: 2 });

      const timeline = await context.app.inject({ method: 'GET', url: '/api/care/timeline', headers: { cookie: context.cookie } });
      expect(timeline.json().items.some((item: { id: string }) => item.id === ids.bathing)).toBe(false);

      const identity = await context.database.pool.query<{
        family_id: string;
        baby_id: string;
        user_id: string;
        membership_id: string;
      }>(
        `select fm.family_id, b.id as baby_id, fm.user_id, fm.id as membership_id
           from family_memberships fm join babies b on b.family_id = fm.family_id
          where fm.relationship = 'dad' limit 1`,
      );
      const row = identity.rows[0]!;
      const foreignActor: CareActorContext = {
        familyId: randomUUID(),
        babyId: row.baby_id,
        userId: row.user_id,
        membershipId: row.membership_id,
        relationship: 'dad',
        permissionLevel: 'family_admin',
      };
      const denied = await createQueryService(context.database).detail(foreignActor, ids.feeding);
      const missing = await context.app.inject({
        method: 'GET',
        url: `/api/care/events/${randomUUID()}`,
        headers: { cookie: context.cookie },
      });
      expect(denied).toBeNull();
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: 'care_event_not_found' });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('fails if a 20-item mixed timeline grows beyond one envelope plus five payload batches', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const identity = await context.database.pool.query<{
        family_id: string;
        baby_id: string;
        user_id: string;
        membership_id: string;
      }>(
        `select fm.family_id, b.id as baby_id, fm.user_id, fm.id as membership_id
           from family_memberships fm join babies b on b.family_id = fm.family_id
          where fm.relationship = 'dad' limit 1`,
      );
      const actor: CareActorContext = {
        familyId: identity.rows[0]!.family_id,
        babyId: identity.rows[0]!.baby_id,
        userId: identity.rows[0]!.user_id,
        membershipId: identity.rows[0]!.membership_id,
        relationship: 'dad',
        permissionLevel: 'family_admin',
      };
      const types = ['feeding', 'diaper', 'sleep', 'bathing', 'temperature'] as const;
      for (let index = 0; index < 20; index += 1) {
        const eventType = types[index % types.length]!;
        const event = await context.database.pool.query<{ id: string }>(
          `insert into care_events (
             family_id, baby_id, actor_user_id, actor_membership_id, source, event_type,
             occurred_at, created_at, updated_at, client_request_id, trace_id
           ) values ($1,$2,$3,$4,'manual',$5,$6,$7,$7,$8,'query-count-test') returning id`,
          [
            actor.familyId,
            actor.babyId,
            actor.userId,
            actor.membershipId,
            eventType,
            new Date(Date.parse(occurredAt) - index * 60_000),
            new Date(Date.parse(occurredAt) + index),
            randomUUID(),
          ],
        );
        const id = event.rows[0]!.id;
        if (eventType === 'feeding') {
          await context.database.pool.query(`insert into feeding_sessions (event_id) values ($1)`, [id]);
          await context.database.pool.query(
            `insert into feeding_components (session_event_id, component_type, liquid_type, amount_ml, occurred_at)
             values ($1, 'bottle', 'formula', 60, $2)`,
            [id, occurredAt],
          );
        } else if (eventType === 'diaper') {
          await context.database.pool.query(`insert into diaper_events (event_id, kind) values ($1, 'urine')`, [id]);
        } else if (eventType === 'sleep') {
          await context.database.pool.query(`insert into sleep_intervals (event_id, started_at) values ($1, $2)`, [id, occurredAt]);
        } else if (eventType === 'bathing') {
          await context.database.pool.query(`insert into care_actions (event_id, action_type) values ($1, 'bathing')`, [id]);
        } else {
          await context.database.pool.query(
            `insert into measurements (event_id, measurement_type, value, method) values ($1, 'temperature', 36.8, 'axillary')`,
            [id],
          );
        }
      }

      const query = vi.spyOn(pg.Client.prototype, 'query');
      const result = await createQueryService(context.database).timeline(actor, { category: 'all', limit: 20 });
      expect(result.items).toHaveLength(20);
      const readQueries = query.mock.calls.filter(([statement]) => (
        typeof statement === 'string' && /^\s*(select|with)\b/i.test(statement)
      ));
      expect(query.mock.calls.some(([statement]) => (
        statement === 'begin isolation level repeatable read read only'
      ))).toBe(true);
      expect(readQueries.length).toBeLessThanOrEqual(6);
      query.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await context.app.close();
      await context.database.close();
    }
  });
});
