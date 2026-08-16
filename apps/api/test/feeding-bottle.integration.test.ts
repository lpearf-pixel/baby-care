import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, postFeeding } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 bottle session', () => {
  it('stores actual consumed ml separately from bottle capacity', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await postFeeding(app, cookie, {
        occurredAt: '2026-08-13T07:50:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
      });
      expect(response.statusCode).toBe(201);
      const eventId = response.json().id as string;
      const stored = await database.pool.query(
        `select amount_ml, bottle_capacity_ml from feeding_components where session_event_id = $1`,
        [eventId],
      );
      expect(stored.rows).toEqual([{ amount_ml: 60, bottle_capacity_ml: 150 }]);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
