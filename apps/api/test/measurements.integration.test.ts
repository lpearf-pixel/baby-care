import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function postMeasurement(app: Awaited<ReturnType<typeof createM2TestApp>>['app'], cookie: string, occurredAt: string, measurement: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/care/measurements',
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload: { occurredAt, clientRequestId: randomUUID(), measurement },
  });
}

describeDatabase('M2 care measurements', () => {
  it('stores temperature in Celsius and weight in kilograms as canonical values', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const temperature = await postMeasurement(app, cookie, '2026-08-13T07:45:00.000Z', {
        kind: 'temperature', valueCelsius: 37.2, method: 'axillary',
      });
      expect(temperature.statusCode).toBe(201);
      const weight = await postMeasurement(app, cookie, '2026-08-13T07:55:00.000Z', {
        kind: 'weight', valueKg: 3.4,
      });
      expect(weight.statusCode).toBe(201);

      const rows = await database.pool.query(
        `select measurement_type, value::float8 as value, method from measurements order by measurement_type`,
      );
      expect(rows.rows).toEqual([
        { measurement_type: 'temperature', value: 37.2, method: 'axillary' },
        { measurement_type: 'weight', value: 3.4, method: null },
      ]);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
