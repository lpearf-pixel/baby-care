import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected cookie pair');
  return pair;
}

describeDatabase('M2 concurrent caregiver attribution', () => {
  it('keeps Dad and Nanny writes distinct while rejecting ownership forgery and disabled sessions', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const dadSession = await context.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: context.cookie } });
      expect(dadSession.statusCode).toBe(200);
      const dad = dadSession.json() as { userId: string; familyId: string; babyId: string };

      const createdNanny = await context.app.inject({
        method: 'POST',
        url: '/api/family/members',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' },
      });
      expect(createdNanny.statusCode).toBe(201);
      const nannyMembershipId = createdNanny.json().membershipId as string;

      const nannyLogin = await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: M2_TEST_ORIGIN },
        payload: { loginName: 'nanny', password: 'nanny-test-password' },
      });
      expect(nannyLogin.statusCode).toBe(200);
      const nannyCookie = sessionCookie(nannyLogin as unknown as { headers: Record<string, unknown> });
      const nanny = nannyLogin.json() as { userId: string; familyId: string; babyId: string };

      const [dadWrite, nannyWrite] = await Promise.all([
        context.app.inject({
          method: 'POST',
          url: '/api/care/actions',
          headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
          payload: {
            occurredAt: '2026-08-13T07:50:00.000Z',
            clientRequestId: randomUUID(),
            action: { kind: 'bathing' },
          },
        }),
        context.app.inject({
          method: 'POST',
          url: '/api/care/measurements',
          headers: { origin: M2_TEST_ORIGIN, cookie: nannyCookie },
          payload: {
            occurredAt: '2026-08-13T07:51:00.000Z',
            clientRequestId: randomUUID(),
            measurement: { kind: 'weight', valueKg: 3.4 },
          },
        }),
      ]);
      expect([dadWrite.statusCode, nannyWrite.statusCode]).toEqual([201, 201]);

      const rows = await context.database.pool.query<{
        id: string;
        actor_user_id: string;
        actor_membership_id: string;
        family_id: string;
        baby_id: string;
        source: string;
      }>(
        `select id, actor_user_id, actor_membership_id, family_id, baby_id, source
           from care_events
          where id = any($1::uuid[])
          order by id`,
        [[dadWrite.json().id, nannyWrite.json().id]],
      );
      expect(rows.rows).toHaveLength(2);
      expect(new Set(rows.rows.map((row) => row.actor_user_id))).toEqual(new Set([dad.userId, nanny.userId]));
      expect(new Set(rows.rows.map((row) => row.actor_membership_id)).size).toBe(2);
      expect(rows.rows.every((row) => row.family_id === dad.familyId && row.family_id === nanny.familyId)).toBe(true);
      expect(rows.rows.every((row) => row.baby_id === dad.babyId && row.baby_id === nanny.babyId)).toBe(true);
      expect(rows.rows.every((row) => row.source === 'manual')).toBe(true);

      const forged = await context.app.inject({
        method: 'POST',
        url: '/api/care/actions',
        headers: { origin: M2_TEST_ORIGIN, cookie: nannyCookie },
        payload: {
          occurredAt: '2026-08-13T07:52:00.000Z',
          clientRequestId: randomUUID(),
          actorUserId: dad.userId,
          familyId: dad.familyId,
          babyId: dad.babyId,
          action: { kind: 'burping' },
        },
      });
      expect(forged.statusCode).toBe(400);
      expect(forged.json()).toMatchObject({ code: 'validation_failed' });

      const disabled = await context.app.inject({
        method: 'PATCH',
        url: `/api/family/members/${nannyMembershipId}/status`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: { status: 'disabled' },
      });
      expect(disabled.statusCode).toBe(200);

      const afterDisable = await context.app.inject({
        method: 'POST',
        url: '/api/care/actions',
        headers: { origin: M2_TEST_ORIGIN, cookie: nannyCookie },
        payload: {
          occurredAt: '2026-08-13T07:53:00.000Z',
          clientRequestId: randomUUID(),
          action: { kind: 'burping' },
        },
      });
      expect(afterDisable.statusCode).toBe(401);
      expect(afterDisable.json()).toMatchObject({ code: 'unauthenticated' });

      const count = await context.database.pool.query(`select count(*)::int as count from care_events`);
      expect(count.rows[0].count).toBe(2);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
