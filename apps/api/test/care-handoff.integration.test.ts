import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CareHandoffBriefingDtoSchema } from '@baby-care/contracts';
import type { CareActorContext } from '../src/care/care-auth.js';
import { findHandoffByClientRequestId } from '../src/care/handoff-repository.js';
import { createHandoffService } from '../src/care/handoff-service.js';
import { createHandoffSummaryService } from '../src/care/handoff-summary-service.js';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const cookie = header.split(';', 1)[0];
  if (!cookie) throw new Error('expected session cookie pair');
  return cookie;
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
  return sessionCookie(login as unknown as { headers: Record<string, unknown> });
}

async function dadActor(context: TestContext): Promise<CareActorContext> {
  const result = await context.database.pool.query<{
    user_id: string;
    membership_id: string;
    family_id: string;
    baby_id: string;
  }>(
    `select u.id as user_id, fm.id as membership_id, fm.family_id, b.id as baby_id
       from users u
       join family_memberships fm on fm.user_id = u.id
       join babies b on b.family_id = fm.family_id
      where u.login_name = 'dad'`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('expected dad actor');
  return {
    userId: row.user_id,
    membershipId: row.membership_id,
    familyId: row.family_id,
    babyId: row.baby_id,
    relationship: 'dad',
    permissionLevel: 'family_admin',
  };
}

async function countCheckpoints(context: TestContext): Promise<number> {
  const result = await context.database.pool.query<{ count: number }>(
    'select count(*)::int as count from care_handoff_checkpoints',
  );
  return result.rows[0]?.count ?? 0;
}

function careHeaders(cookie: string, traceId?: string) {
  return { origin: M2_TEST_ORIGIN, cookie, ...(traceId ? { 'x-trace-id': traceId } : {}) };
}

async function postCare(
  context: TestContext,
  cookie: string,
  url: string,
  payload: Record<string, unknown>,
  expectedStatus = 201,
) {
  const response = await context.app.inject({
    method: 'POST',
    url,
    headers: careHeaders(cookie),
    payload,
  });
  expect(response.statusCode).toBe(expectedStatus);
  return response;
}

async function createCheckpoint(
  context: TestContext,
  cookie: string,
  occurredAt: string,
  clientRequestId = randomUUID(),
  expectedStatus = 201,
) {
  return postCare(context, cookie, '/api/care/handoffs', { occurredAt, clientRequestId }, expectedStatus);
}

describeDatabase('M3 explicit care handoff', () => {
  it('derives incoming caregiver identity, is idempotent, and preserves fixed checkpoint boundaries', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const requestId = randomUUID();
      const dadHandoff = await createCheckpoint(context, context.cookie, '2026-08-13T07:00:00.000Z', requestId);
      expect(dadHandoff.statusCode).toBe(201);
      expect(dadHandoff.json()).toMatchObject({
        checkpoint: { actorDisplayName: 'Dad', source: 'manual', occurredAt: '2026-08-13T07:00:00.000Z' },
        previousCheckpoint: null,
        window: {
          mode: 'rolling_24h',
          from: '2026-08-12T07:00:00.000Z',
          to: '2026-08-13T07:00:00.000Z',
        },
      });

      const duplicate = await createCheckpoint(context, context.cookie, '2026-08-13T07:00:00.000Z', requestId);
      expect(duplicate.json()).toEqual(dadHandoff.json());
      expect(await countCheckpoints(context)).toBe(1);

      const nannyCookie = await createNanny(context);
      expect(await countCheckpoints(context)).toBe(1);
      const nannyHandoff = await createCheckpoint(context, nannyCookie, '2026-08-13T07:30:00.000Z');
      const nannyBriefing = nannyHandoff.json();
      expect(nannyBriefing).toMatchObject({
        checkpoint: { actorDisplayName: 'Nanny', source: 'manual', occurredAt: '2026-08-13T07:30:00.000Z' },
        previousCheckpoint: { id: dadHandoff.json().checkpoint.id, actorDisplayName: 'Dad' },
        window: {
          mode: 'checkpoint',
          from: '2026-08-13T07:00:00.000Z',
          to: '2026-08-13T07:30:00.000Z',
        },
      });

      const acceptedSkew = await createCheckpoint(context, context.cookie, '2026-08-13T08:05:00.000Z');
      expect(acceptedSkew.statusCode).toBe(201);
      const latest = await context.app.inject({
        method: 'GET',
        url: '/api/care/handoffs/latest',
        headers: { cookie: context.cookie },
      });
      expect(latest.statusCode).toBe(200);
      expect(latest.json().checkpoint.id).toBe(acceptedSkew.json().checkpoint.id);
      const rejectedSkew = await createCheckpoint(
        context,
        context.cookie,
        '2026-08-13T08:05:00.001Z',
        randomUUID(),
        400,
      );
      expect(rejectedSkew.statusCode).toBe(400);
      expect(rejectedSkew.json()).toMatchObject({ code: 'validation_failed' });

      const reopened = await context.app.inject({
        method: 'GET',
        url: `/api/care/handoffs/${nannyBriefing.checkpoint.id}/summary`,
        headers: { cookie: nannyCookie },
      });
      expect(reopened.statusCode).toBe(200);
      expect(reopened.json().window).toEqual(nannyBriefing.window);

      const direct = await createHandoffSummaryService(context.database).byId(
        await dadActor(context),
        nannyBriefing.checkpoint.id,
      );
      expect(direct.window.to).toBe('2026-08-13T07:30:00.000Z');

      const audit = await context.database.pool.query<{ metadata_json: Record<string, unknown> }>(
        `select metadata_json from audit_events
          where action = 'care.handoff_created' and target_id = $1`,
        [nannyBriefing.checkpoint.id],
      );
      expect(audit.rows[0]?.metadata_json).toEqual({
        checkpointId: nannyBriefing.checkpoint.id,
        source: 'manual',
        traceId: expect.any(String),
      });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('summarizes factual care in (previous checkpoint, current checkpoint] with complete bounded counts', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const nannyCookie = await createNanny(context);
      await createCheckpoint(context, context.cookie, '2026-08-13T06:00:00.000Z');

      await postCare(context, context.cookie, '/api/care/feeding-sessions', {
        occurredAt: '2026-08-13T06:00:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 99, bottleCapacityMl: 200 }],
      });
      await postCare(context, context.cookie, '/api/care/feeding-sessions', {
        occurredAt: '2026-08-13T06:30:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
      });
      const completedSleep = await postCare(context, context.cookie, '/api/care/sleep/start', {
        occurredAt: '2026-08-13T06:20:00.000Z',
        clientRequestId: randomUUID(),
      });
      const revisedSleep = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${completedSleep.json().id}`,
        headers: careHeaders(nannyCookie),
        payload: {
          eventType: 'sleep',
          startedAt: '2026-08-13T06:20:00.000Z',
          endedAt: '2026-08-13T06:50:00.000Z',
        },
      });
      expect(revisedSleep.statusCode).toBe(200);
      const seededRevision = await context.database.pool.query<{
        revision_action: string;
        actor_display_name: string;
      }>(
        `select cr.revision_action, u.display_name as actor_display_name
           from care_event_revisions cr
           join users u on u.id = cr.edit_actor_user_id
          where cr.event_id = $1`,
        [completedSleep.json().id],
      );
      expect(seededRevision.rows).toEqual([{ revision_action: 'edit', actor_display_name: 'Nanny' }]);
      for (let minute = 0; minute < 15; minute += 1) {
        await postCare(context, context.cookie, '/api/care/actions', {
          occurredAt: `2026-08-13T07:${String(minute).padStart(2, '0')}:00.000Z`,
          clientRequestId: randomUUID(),
          confirmedWarnings: ['possible_duplicate'],
          action: { kind: 'bathing' },
        });
      }
      await postCare(context, context.cookie, '/api/care/feeding-sessions', {
        occurredAt: '2026-08-13T07:20:00.000Z',
        clientRequestId: randomUUID(),
        components: [
          { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 30, bottleCapacityMl: 90 },
          { kind: 'direct_breastfeeding', durationMinutes: 18 },
        ],
      });
      await postCare(context, nannyCookie, '/api/care/diapers', {
        occurredAt: '2026-08-13T07:30:00.000Z',
        clientRequestId: randomUUID(),
        kind: 'urine_stool',
      });
      await postCare(context, nannyCookie, '/api/care/actions', {
        occurredAt: '2026-08-13T07:40:00.000Z',
        clientRequestId: randomUUID(),
        action: { kind: 'medication', medicationName: 'Recorded medicine', dose: 1.25, doseUnit: 'mL' },
      });
      await postCare(context, context.cookie, '/api/care/sleep/start', {
        occurredAt: '2026-08-13T07:50:00.000Z',
        clientRequestId: randomUUID(),
      });
      await postCare(context, context.cookie, '/api/care/measurements', {
        occurredAt: '2026-08-13T08:00:00.000Z',
        clientRequestId: randomUUID(),
        measurement: { kind: 'temperature', valueCelsius: 37.2, method: 'axillary' },
      });

      const response = await createCheckpoint(context, context.cookie, '2026-08-13T08:00:00.000Z');
      expect(response.statusCode).toBe(201);
      const briefing = response.json();
      expect(CareHandoffBriefingDtoSchema.safeParse(briefing).success).toBe(true);
      expect(briefing.window).toEqual({
        mode: 'checkpoint',
        from: '2026-08-13T06:00:00.000Z',
        to: '2026-08-13T08:00:00.000Z',
      });
      expect(briefing.feeding).toEqual({
        bottleTotalMl: 90,
        expressedBreastMilkMl: 30,
        formulaMl: 60,
        directBreastfeedingSessions: 1,
        directBreastfeedingMinutes: 18,
      });
      expect(briefing.diapers).toEqual({ urine: 0, stool: 0, urineStool: 1 });
      expect(briefing.sleep).toEqual({ intervals: 1, completedMinutes: 30 });
      expect(briefing.careState.currentSleep).toEqual({
        intervalId: expect.any(String),
        startedAt: '2026-08-13T07:50:00.000Z',
      });
      expect(briefing.notableEvents).toHaveLength(20);
      expect(briefing.notableEventCount).toBe(22);
      expect(briefing.actorActivity).toEqual([
        { actorUserId: expect.any(String), actorDisplayName: 'Dad', eventCount: 20 },
        { actorUserId: expect.any(String), actorDisplayName: 'Nanny', eventCount: 2 },
      ]);
      expect(briefing.corrections).toEqual([
        {
          eventId: expect.any(String),
          action: 'edit',
          actorDisplayName: 'Nanny',
          createdAt: expect.any(String),
        },
      ]);
      expect(briefing.correctionCount).toBe(1);
      expect(briefing.notableEvents).toContainEqual(expect.objectContaining({
        eventType: 'medication',
        payload: {
          action: {
            kind: 'medication',
            medicationName: 'Recorded medicine',
            dose: 1.25,
            doseUnit: 'mL',
          },
        },
      }));

      await postCare(context, context.cookie, '/api/care/actions', {
        occurredAt: '2026-08-13T08:01:00.000Z',
        clientRequestId: randomUUID(),
        action: { kind: 'burping' },
      });
      const reopened = await context.app.inject({
        method: 'GET',
        url: `/api/care/handoffs/${briefing.checkpoint.id}/summary`,
        headers: { cookie: context.cookie },
      });
      expect(reopened.json().window.to).toBe('2026-08-13T08:00:00.000Z');
      expect(reopened.json().notableEventCount).toBe(22);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('replaces only the authenticated membership reminders without creating checkpoint facts', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const nannyCookie = await createNanny(context);
      await createCheckpoint(context, context.cookie, '2026-08-13T07:00:00.000Z');
      const checkpointsBeforeReminderRead = await countCheckpoints(context);

      const dadReplace = await context.app.inject({
        method: 'PUT',
        url: '/api/care/handoff-reminders',
        headers: careHeaders(context.cookie),
        payload: { rules: [{ localTime: '16:00', weekdays: [4], enabled: true }] },
      });
      expect(dadReplace.statusCode).toBe(200);
      const nannyReplace = await context.app.inject({
        method: 'PUT',
        url: '/api/care/handoff-reminders',
        headers: careHeaders(nannyCookie),
        payload: { rules: [{ localTime: '17:00', weekdays: [4], enabled: true }] },
      });
      expect(nannyReplace.statusCode).toBe(200);

      const dadRead = await context.app.inject({
        method: 'GET',
        url: '/api/care/handoff-reminders',
        headers: { cookie: context.cookie },
      });
      expect(dadRead.statusCode).toBe(200);
      const reminder = dadRead.json();
      expect(reminder).toEqual({
        rules: [{ localTime: '16:00', weekdays: [4], enabled: true }],
        shouldPrompt: true,
      });
      expect(await countCheckpoints(context)).toBe(checkpointsBeforeReminderRead);

      const nannyRead = await context.app.inject({
        method: 'GET',
        url: '/api/care/handoff-reminders',
        headers: { cookie: nannyCookie },
      });
      expect(nannyRead.json()).toEqual({
        rules: [{ localTime: '17:00', weekdays: [4], enabled: true }],
        shouldPrompt: false,
      });
      const oversized = await context.app.inject({
        method: 'PUT',
        url: '/api/care/handoff-reminders',
        headers: careHeaders(context.cookie),
        payload: {
          rules: Array.from({ length: 17 }, (_, index) => ({
            localTime: `${String(index).padStart(2, '0')}:00`,
            weekdays: [4],
            enabled: true,
          })),
        },
      });
      expect(oversized.statusCode).toBe(400);
      expect(await countCheckpoints(context)).toBe(checkpointsBeforeReminderRead);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('recovers idempotency by the declared family-user-request key without crossing family or user scope', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const actor = await dadActor(context);
      const clientRequestId = randomUUID();
      const handoffs = createHandoffService(context.database, () => new Date('2026-08-13T08:00:00.000Z'));
      const original = await handoffs.create(actor, {
        occurredAt: '2026-08-13T07:00:00.000Z',
        clientRequestId,
      }, 'idempotency-original');
      const shiftedContext = {
        ...actor,
        babyId: randomUUID(),
        membershipId: randomUUID(),
      };

      const recovered = await handoffs.create(shiftedContext, {
        occurredAt: '2026-08-13T07:30:00.000Z',
        clientRequestId,
      }, 'idempotency-retry');
      expect(recovered.checkpoint.id).toBe(original.checkpoint.id);
      expect(recovered.checkpoint.occurredAt).toBe('2026-08-13T07:00:00.000Z');
      expect(await countCheckpoints(context)).toBe(1);

      const client = await context.database.pool.connect();
      try {
        expect((await findHandoffByClientRequestId(client, shiftedContext, clientRequestId))?.id)
          .toBe(original.checkpoint.id);
        expect(await findHandoffByClientRequestId(client, {
          ...shiftedContext,
          familyId: randomUUID(),
        }, clientRequestId)).toBeNull();
        expect(await findHandoffByClientRequestId(client, {
          ...shiftedContext,
          userId: randomUUID(),
        }, clientRequestId)).toBeNull();
      } finally {
        client.release();
      }
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
