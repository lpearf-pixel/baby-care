import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, postFeeding } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 feeding related actions', () => {
  it('links burping and spit-up events to the feeding session', async () => {
    const { app, database, cookie } = await createM2TestApp(testDatabaseUrl!);
    try {
      const response = await postFeeding(app, cookie, {
        occurredAt: '2026-08-13T07:30:00.000Z',
        clientRequestId: randomUUID(),
        components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 50 }],
        relatedActions: [{ kind: 'burping' }, { kind: 'spit_up', amount: 'small' }],
      });
      expect(response.statusCode).toBe(201);
      const eventId = response.json().id as string;
      const actions = await database.pool.query(
        `select action_type, feeding_session_event_id from care_actions where feeding_session_event_id = $1 order by action_type`,
        [eventId],
      );
      expect(actions.rows).toEqual([
        { action_type: 'burping', feeding_session_event_id: eventId },
        { action_type: 'spit_up', feeding_session_event_id: eventId },
      ]);
    } finally {
      await app.close();
      await database.close();
    }
  });
});
