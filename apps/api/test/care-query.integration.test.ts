import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CareTimelineResponseSchema } from '@baby-care/contracts';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

type TestContext = Awaited<ReturnType<typeof createM2TestApp>>;

async function postFeed(context: TestContext, occurredAt: string, components: unknown[], confirmedWarnings?: string[]) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/care/feeding-sessions',
    headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
    payload: { occurredAt, clientRequestId: randomUUID(), components, confirmedWarnings },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function postDiaper(context: TestContext, occurredAt: string, kind: 'urine' | 'stool' | 'urine_stool') {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/care/diapers',
    headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
    payload: { occurredAt, clientRequestId: randomUUID(), kind },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as { id: string };
}

async function seedSummaryScenario(context: TestContext) {
  await postFeed(context, '2026-08-12T08:00:00.000Z', [
    { kind: 'bottle', liquidType: 'formula', amountMl: 40, bottleCapacityMl: 150 },
  ]);
  await postFeed(context, '2026-08-12T07:59:59.000Z', [
    { kind: 'bottle', liquidType: 'formula', amountMl: 99, bottleCapacityMl: 200 },
  ], ['old_backfill']);
  await postFeed(context, '2026-08-13T07:00:00.000Z', [
    { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 30, bottleCapacityMl: 90 },
  ]);
  const voided = await postFeed(context, '2026-08-13T07:30:00.000Z', [
    { kind: 'bottle', liquidType: 'formula', amountMl: 20, bottleCapacityMl: 150 },
  ]);
  await context.database.pool.query(`update care_events set status = 'voided' where id = $1`, [voided.id]);
  await context.database.pool.query(`update care_events set status = 'voided' where id in (
    select event_id from care_actions where feeding_session_event_id = $1
  )`, [voided.id]);

  await context.app.inject({
    method: 'POST',
    url: '/api/care/sleep/start',
    headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
    payload: { occurredAt: '2026-08-13T07:40:00.000Z', clientRequestId: randomUUID() },
  });
  await postFeed(context, '2026-08-13T07:50:00.000Z', [
    { kind: 'direct_breastfeeding', durationMinutes: 18 },
    { kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 },
  ]);
  await postDiaper(context, '2026-08-13T07:55:00.000Z', 'urine');
}

describeDatabase('M2 care summary and timeline', () => {
  it('computes the inclusive rolling 24h summary without treating bottle capacity as intake', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      await seedSummaryScenario(context);
      const response = await context.app.inject({
        method: 'GET',
        url: '/api/care/summary?at=2026-08-13T08:00:00.000Z',
        headers: { cookie: context.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        asOf: '2026-08-13T08:00:00.000Z',
        lastFeeding: {
          occurredAt: '2026-08-13T07:50:00.000Z',
          bottle: { liquidType: 'formula', amountMl: 60 },
          directBreastfeedingMinutes: 18,
        },
        lastDiaper: { occurredAt: '2026-08-13T07:55:00.000Z', kind: 'urine' },
        rolling24h: {
          bottleTotalMl: 130,
          expressedBreastMilkMl: 30,
          formulaMl: 100,
          directBreastfeedingSessions: 1,
          directBreastfeedingMinutes: 18,
        },
        currentSleep: {
          intervalId: expect.any(String),
          startedAt: '2026-08-13T07:40:00.000Z',
        },
      });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('returns active timeline items ordered by occurred time then creation time', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      await seedSummaryScenario(context);
      const response = await context.app.inject({
        method: 'GET',
        url: '/api/care/timeline?before=2026-08-13T08:00:00.000Z&limit=10',
        headers: { cookie: context.cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(CareTimelineResponseSchema.safeParse(response.json()).success).toBe(true);
      const items = response.json().items as Array<{ eventType: string; occurredAt: string; status: string }>;
      expect(items.slice(0, 4).map((item) => [item.eventType, item.occurredAt])).toEqual([
        ['diaper', '2026-08-13T07:55:00.000Z'],
        ['feeding', '2026-08-13T07:50:00.000Z'],
        ['sleep', '2026-08-13T07:40:00.000Z'],
        ['feeding', '2026-08-13T07:00:00.000Z'],
      ]);
      expect(items.every((item) => item.status === 'active')).toBe(true);
      expect(items.some((item) => item.occurredAt === '2026-08-13T07:30:00.000Z')).toBe(false);
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('rejects M3 timeline query modes until typed cursor reads are implemented', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await context.app.inject({
        method: 'GET',
        url: '/api/care/timeline?cursor=opaque-m3-cursor',
        headers: { cookie: context.cookie },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'validation_failed' });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
