import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 medication fact recording', () => {
  it('records what was administered without exposing recommendation behavior or private values in audit metadata', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/care/actions',
        headers: { origin: M2_TEST_ORIGIN, cookie },
        payload: {
          occurredAt: '2026-08-13T07:50:00.000Z',
          clientRequestId: randomUUID(),
          note: 'given after feeding',
          action: {
            kind: 'medication',
            medicationName: 'Example Medication',
            dose: 0.5,
            doseUnit: 'mL',
          },
        },
      });
      expect(response.statusCode).toBe(201);

      const stored = await database.pool.query(
        `select medication_name, medication_dose::float8 as medication_dose, medication_dose_unit
           from care_actions where event_id = $1`,
        [response.json().id],
      );
      expect(stored.rows).toEqual([{
        medication_name: 'Example Medication',
        medication_dose: 0.5,
        medication_dose_unit: 'mL',
      }]);

      const audits = await database.pool.query(`select metadata_json from audit_events where action = 'care.event_created'`);
      const auditText = JSON.stringify(audits.rows);
      expect(auditText).not.toContain('Example Medication');
      expect(auditText).not.toContain('given after feeding');
      expect(auditText).not.toContain('0.5');

      const recommendation = await app.inject({
        method: 'POST',
        url: '/api/care/medication/recommendation',
        headers: { origin: M2_TEST_ORIGIN, cookie },
        payload: { medicationName: 'Example Medication' },
      });
      expect(recommendation.statusCode).toBe(404);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
