import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createM2TestApp, M2_TEST_ORIGIN } from './helpers/m2-family-app.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase('M2 feeding correction and undo', () => {
  it('reconciles feeding components and linked care actions transactionally on edit', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/care/feeding-sessions',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          occurredAt: '2026-08-13T07:30:00.000Z',
          clientRequestId: randomUUID(),
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60, bottleCapacityMl: 150 }],
          relatedActions: [{ kind: 'burping' }],
        },
      });
      expect(created.statusCode).toBe(201);
      const eventId = created.json().id as string;
      const originalLinked = await context.database.pool.query<{ id: string }>(
        `select ce.id from care_events ce join care_actions ca on ca.event_id = ce.id where ca.feeding_session_event_id = $1`,
        [eventId],
      );
      expect(originalLinked.rows).toHaveLength(1);

      const edited = await context.app.inject({
        method: 'PATCH',
        url: `/api/care/events/${eventId}`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          eventType: 'feeding',
          occurredAt: '2026-08-13T07:31:00.000Z',
          note: 'corrected session',
          components: [
            { kind: 'direct_breastfeeding', durationMinutes: 10 },
            { kind: 'bottle', liquidType: 'formula', amountMl: 75, bottleCapacityMl: 150 },
          ],
          relatedActions: [{ kind: 'spit_up', amount: 'medium' }],
        },
      });
      expect(edited.statusCode).toBe(200);

      const components = await context.database.pool.query(
        `select component_type, liquid_type, amount_ml, duration_minutes from feeding_components where session_event_id = $1 order by component_type`,
        [eventId],
      );
      expect(components.rows).toEqual([
        { component_type: 'direct_breastfeeding', liquid_type: null, amount_ml: null, duration_minutes: 10 },
        { component_type: 'bottle', liquid_type: 'formula', amount_ml: 75, duration_minutes: null },
      ]);
      const oldLinkedStatus = await context.database.pool.query(`select status from care_events where id = $1`, [originalLinked.rows[0]!.id]);
      expect(oldLinkedStatus.rows[0].status).toBe('voided');
      const activeLinked = await context.database.pool.query(
        `select ca.action_type, ca.spit_up_amount
           from care_actions ca join care_events ce on ce.id = ca.event_id
          where ca.feeding_session_event_id = $1 and ce.status = 'active'`,
        [eventId],
      );
      expect(activeLinked.rows).toEqual([{ action_type: 'spit_up', spit_up_amount: 'medium' }]);
      const revision = await context.database.pool.query(`select before_json, after_json from care_event_revisions where event_id = $1 and revision_action = 'edit'`, [eventId]);
      expect(revision.rows).toHaveLength(1);
      expect(revision.rows[0].after_json).toMatchObject({ note: 'corrected session' });
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });

  it('undoes a feeding session and every linked action without deleting rows', async () => {
    const context = await createM2TestApp(testDatabaseUrl!);
    try {
      const created = await context.app.inject({
        method: 'POST',
        url: '/api/care/feeding-sessions',
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
        payload: {
          occurredAt: '2026-08-13T07:40:00.000Z',
          clientRequestId: randomUUID(),
          components: [{ kind: 'bottle', liquidType: 'formula', amountMl: 60 }],
          relatedActions: [{ kind: 'burping' }, { kind: 'spit_up', amount: 'small' }],
        },
      });
      expect(created.statusCode).toBe(201);
      const eventId = created.json().id as string;
      const linked = await context.database.pool.query<{ id: string }>(
        `select ce.id from care_events ce join care_actions ca on ca.event_id = ce.id where ca.feeding_session_event_id = $1 order by ce.id`,
        [eventId],
      );
      expect(linked.rows).toHaveLength(2);

      const undone = await context.app.inject({
        method: 'POST',
        url: `/api/care/events/${eventId}/undo`,
        headers: { origin: M2_TEST_ORIGIN, cookie: context.cookie },
      });
      expect(undone.statusCode).toBe(200);
      expect(undone.json()).toMatchObject({ id: eventId, status: 'voided' });

      const allIds = [eventId, ...linked.rows.map((row) => row.id)];
      const states = await context.database.pool.query(
        `select id, status from care_events where id = any($1::uuid[]) order by id`,
        [allIds],
      );
      expect(states.rows).toHaveLength(3);
      expect(states.rows.every((row) => row.status === 'voided')).toBe(true);
      const actionRows = await context.database.pool.query(`select count(*)::int as count from care_actions where feeding_session_event_id = $1`, [eventId]);
      expect(actionRows.rows[0].count).toBe(2);
      const revisions = await context.database.pool.query(
        `select event_id, revision_action from care_event_revisions where event_id = any($1::uuid[])`,
        [allIds],
      );
      expect(revisions.rows.filter((row) => row.revision_action === 'void')).toHaveLength(3);

      const quickValues = await context.app.inject({
        method: 'GET',
        url: '/api/care/feeding/quick-values?liquidType=formula',
        headers: { cookie: context.cookie },
      });
      expect(quickValues.statusCode).toBe(200);
      expect(quickValues.json()).toEqual({ liquidType: 'formula', values: [] });

      const summary = await context.app.inject({
        method: 'GET',
        url: '/api/care/summary?at=2026-08-13T08:00:00.000Z',
        headers: { cookie: context.cookie },
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().lastFeeding).toBeNull();
    } finally {
      await context.app.close();
      await context.database.close();
    }
  });
});
