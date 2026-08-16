import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 diaper recording', () => {
  it('stores a urine-only change without requiring stool details', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/care/diapers',
        headers: { origin: M2_TEST_ORIGIN, cookie },
        payload: {
          occurredAt: '2026-08-13T07:55:00.000Z',
          clientRequestId: randomUUID(),
          kind: 'urine',
        },
      });
      expect(response.statusCode).toBe(201);
      const stored = await database.pool.query(
        `select kind, stool_color, stool_consistency, stool_amount from diaper_events where event_id = $1`,
        [response.json().id],
      );
      expect(stored.rows).toEqual([{
        kind: 'urine',
        stool_color: null,
        stool_consistency: null,
        stool_amount: null,
      }]);
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('stores optional stool details when present', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/care/diapers',
        headers: { origin: M2_TEST_ORIGIN, cookie },
        payload: {
          occurredAt: '2026-08-13T07:50:00.000Z',
          clientRequestId: randomUUID(),
          kind: 'stool',
          stoolColor: 'yellow',
          stoolConsistency: 'seedy',
          stoolAmount: 'medium',
        },
      });
      expect(response.statusCode).toBe(201);
      const stored = await database.pool.query(
        `select kind, stool_color, stool_consistency, stool_amount from diaper_events where event_id = $1`,
        [response.json().id],
      );
      expect(stored.rows).toEqual([{
        kind: 'stool',
        stool_color: 'yellow',
        stool_consistency: 'seedy',
        stool_amount: 'medium',
      }]);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
