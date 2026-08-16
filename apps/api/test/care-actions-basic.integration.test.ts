import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

function postAction(app: Awaited<ReturnType<typeof createM2TestApp>>['app'], cookie: string, occurredAt: string, action: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/care/actions',
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload: { occurredAt, clientRequestId: randomUUID(), action },
  });
}

describeDatabase('M2 frequent care actions', () => {
  it('records burping, spit-up, crying, and bathing as attributed care facts', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const cases = [
        ['2026-08-13T07:40:00.000Z', { kind: 'burping' }],
        ['2026-08-13T07:45:00.000Z', { kind: 'spit_up', amount: 'small' }],
        ['2026-08-13T07:50:00.000Z', { kind: 'crying', durationMinutes: 8 }],
        ['2026-08-13T07:55:00.000Z', { kind: 'bathing' }],
      ] as const;
      for (const [occurredAt, action] of cases) {
        const response = await postAction(app, cookie, occurredAt, action);
        expect(response.statusCode).toBe(201);
      }
      const rows = await database.pool.query(
        `select action_type, spit_up_amount, crying_duration_minutes from care_actions order by action_type`,
      );
      expect(rows.rows.map((row) => row.action_type).sort()).toEqual(['bathing', 'burping', 'crying', 'spit_up']);
      expect(rows.rows.find((row) => row.action_type === 'spit_up')?.spit_up_amount).toBe('small');
      expect(rows.rows.find((row) => row.action_type === 'crying')?.crying_duration_minutes).toBe(8);
    } finally {
      await app.close();
      await database.close();
    }
  });

  it('warns instead of silently merging a likely duplicate action', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      expect((await postAction(app, cookie, '2026-08-13T07:50:00.000Z', { kind: 'bathing' })).statusCode).toBe(201);
      const warning = await postAction(app, cookie, '2026-08-13T07:52:00.000Z', { kind: 'bathing' });
      expect(warning.statusCode).toBe(409);
      expect(warning.json()).toMatchObject({
        code: 'care_confirmation_required',
        details: { warnings: [{ code: 'possible_duplicate' }] },
      });
      const count = await database.pool.query(`select count(*)::int as count from care_actions`);
      expect(count.rows[0].count).toBe(1);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
