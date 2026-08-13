import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, postFeeding } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 feeding unusual value confirmation', () => {
  it('does not write an unusual amount before explicit confirmation', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      for (const [time, amount] of [
        ['2026-08-13T07:20:00.000Z', 60],
        ['2026-08-13T07:00:00.000Z', 60],
        ['2026-08-13T06:40:00.000Z', 70],
      ] as const) {
        const seeded = await postFeeding(app, cookie, {
          occurredAt: time,
          clientRequestId: randomUUID(),
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: amount }],
        });
        expect(seeded.statusCode).toBe(201);
      }

      const requestId = randomUUID();
      const payload = {
        occurredAt: '2026-08-13T07:50:00.000Z',
        clientRequestId: requestId,
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 190 }],
      };
      const warning = await postFeeding(app, cookie, payload);
      expect(warning.statusCode).toBe(409);
      expect(warning.json()).toMatchObject({
        code: 'care_confirmation_required',
        details: { warnings: [expect.objectContaining({ code: 'unusual_value' })] },
      });
      expect((await database.pool.query(`select 1 from care_events where client_request_id = $1`, [requestId])).rowCount).toBe(0);

      const confirmed = await postFeeding(app, cookie, { ...payload, confirmedWarnings: ['unusual_value'] });
      expect(confirmed.statusCode).toBe(201);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
