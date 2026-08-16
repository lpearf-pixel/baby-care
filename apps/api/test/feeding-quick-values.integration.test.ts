import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, postFeeding } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function bottle(occurredAt: string, liquidType: 'formula' | 'expressed_breast_milk', amountMl: number) {
  return {
    occurredAt,
    clientRequestId: randomUUID(),
    components: [{ kind: 'bottle', liquidType, amountMl }],
  };
}

describeDatabase('M2 feeding quick values', () => {
  it('learns formula and expressed breast milk histories independently', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      for (const payload of [
        bottle('2026-08-13T07:40:00.000Z', 'formula', 60),
        bottle('2026-08-13T07:20:00.000Z', 'formula', 50),
        bottle('2026-08-13T07:00:00.000Z', 'formula', 60),
        bottle('2026-08-13T06:40:00.000Z', 'expressed_breast_milk', 40),
        bottle('2026-08-13T06:20:00.000Z', 'expressed_breast_milk', 40),
        bottle('2026-08-13T06:00:00.000Z', 'expressed_breast_milk', 30),
      ]) {
        expect((await postFeeding(app, cookie, payload)).statusCode).toBe(201);
      }

      const formula = await app.inject({
        method: 'GET', url: '/api/care/feeding/quick-values?liquidType=formula', headers: { cookie },
      });
      const expressed = await app.inject({
        method: 'GET', url: '/api/care/feeding/quick-values?liquidType=expressed_breast_milk', headers: { cookie },
      });
      expect(formula.statusCode).toBe(200);
      expect(formula.json()).toEqual({ liquidType: 'formula', values: [60, 50] });
      expect(expressed.statusCode).toBe(200);
      expect(expressed.json()).toEqual({ liquidType: 'expressed_breast_milk', values: [40, 30] });
    } finally {
      await app.close();
      await database.close();
    }
  });
});
