import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, postFeeding } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 direct and mixed feeding', () => {
  it('stores direct breastfeeding as minutes with no ml', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await postFeeding(app, cookie, {
        occurredAt: '2026-08-13T07:40:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'direct_breastfeeding', durationMinutes: 18 }],
      });
      expect(response.statusCode).toBe(201);
      const stored = await database.pool.query(
        `select amount_ml, duration_minutes from feeding_components where session_event_id = $1`,
        [response.json().id],
      );
      expect(stored.rows).toEqual([{ amount_ml: null, duration_minutes: 18 }]);
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('keeps direct and bottle components in one session', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await postFeeding(app, cookie, {
        occurredAt: '2026-08-13T07:20:00.000Z',
        clientRequestId: randomUUID(),
        components: [
          { kind: 'direct_breastfeeding', durationMinutes: 12 },
          { kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 45 },
        ],
      });
      expect(response.statusCode).toBe(201);
      const count = await database.pool.query<{ count: string }>(
        `select count(*)::text as count from feeding_components where session_event_id = $1`,
        [response.json().id],
      );
      expect(count.rows[0]?.count).toBe('2');
    } finally {
      await app.close();
      await database.close();
    }
  });
});
