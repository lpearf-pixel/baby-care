import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { DatabaseContext } from '../src/db.js';
import type { CareActorContext } from '../src/care/care-auth.js';
import { createHandoffSummaryService } from '../src/care/handoff-summary-service.js';

const actor: CareActorContext = {
  familyId: '11111111-1111-4111-8111-111111111111',
  babyId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333',
  membershipId: '44444444-4444-4444-8444-444444444444',
  relationship: 'dad',
  permissionLevel: 'family_admin',
};

const checkpoint = {
  id: '55555555-5555-4555-8555-555555555555',
  family_id: actor.familyId,
  baby_id: actor.babyId,
  actor_user_id: actor.userId,
  actor_membership_id: actor.membershipId,
  source: 'manual',
  occurred_at: new Date('2026-08-13T08:00:00.000Z'),
  created_at: new Date('2026-08-13T08:00:01.000Z'),
  client_request_id: '66666666-6666-4666-8666-666666666666',
  trace_id: 'handoff-test',
  actor_display_name: 'Dad',
} as const;

const previous = {
  ...checkpoint,
  id: '77777777-7777-4777-8777-777777777777',
  occurred_at: new Date('2026-08-13T07:00:00.000Z'),
  created_at: new Date('2026-08-13T07:00:01.000Z'),
};

function rows<T>(...values: T[]) {
  return { rows: values };
}

describe('handoff briefing read snapshot', () => {
  it('uses one repeatable-read client and evaluates sleep at the checkpoint asOf', async () => {
    const statements: string[] = [];
    const clientQuery = vi.fn(async (statement: string) => {
      const sql = statement.replace(/\s+/g, ' ').trim();
      statements.push(sql);
      if (sql === 'begin isolation level repeatable read read only') return rows();
      if (sql === 'commit' || sql === 'rollback') return rows();
      if (sql.includes('from care_handoff_checkpoints hc') && sql.includes('where hc.id = $1')) return rows(checkpoint);
      if (sql.includes('from care_handoff_checkpoints hc') && sql.includes('(hc.occurred_at, hc.created_at, hc.id) <')) return rows(previous);
      if (sql.includes('from care_events') && sql.includes("event_type = 'feeding'") && sql.includes('limit 1')) return rows();
      if (sql.includes('from care_events ce') && sql.includes('join diaper_events') && sql.includes('limit 1')) return rows();
      if (sql.includes('from feeding_components fc') && sql.includes("interval '24 hours'")) {
        return rows({
          bottle_total_ml: 0,
          expressed_breast_milk_ml: 0,
          formula_ml: 0,
          direct_breastfeeding_sessions: 0,
          direct_breastfeeding_minutes: 0,
        });
      }
      if (sql.includes('from sleep_intervals si') && sql.includes('limit 2')) {
        expect(sql).toContain('(si.ended_at is null or si.ended_at > $3)');
        return rows({
          event_id: '88888888-8888-4888-8888-888888888888',
          started_at: new Date('2026-08-13T07:50:00.000Z'),
        });
      }
      if (sql.includes('from care_events ce') && sql.includes('to_char(ce.occurred_at')) return rows();
      if (sql.includes('from feeding_components fc')) {
        return rows({
          bottle_total_ml: 0,
          expressed_breast_milk_ml: 0,
          formula_ml: 0,
          direct_breastfeeding_sessions: 0,
          direct_breastfeeding_minutes: 0,
        });
      }
      if (sql.includes('from diaper_events de')) return rows({ urine: 0, stool: 0, urine_stool: 0 });
      if (sql.includes('from sleep_intervals si')) return rows({ intervals: 0, completed_minutes: 0 });
      if (sql.startsWith('select count(*)::int as count from care_events')) return rows({ count: 0 });
      if (sql.includes('group by ce.actor_user_id')) return rows();
      if (sql.includes('from care_event_revisions cr')) return rows();
      throw new Error(`Unexpected briefing query: ${sql}`);
    });
    const client = {
      query: clientQuery,
      release: vi.fn(),
    } as unknown as pg.PoolClient;
    const poolQuery = vi.fn(async () => {
      throw new Error('briefing escaped its read snapshot');
    });
    const poolConnect = vi.fn(async () => client);
    const database = {
      pool: {
        connect: poolConnect,
        query: poolQuery,
      },
    } as unknown as DatabaseContext;

    const briefing = await createHandoffSummaryService(database).byId(actor, checkpoint.id);

    expect(briefing.careState.currentSleep).toEqual({
      intervalId: '88888888-8888-4888-8888-888888888888',
      startedAt: '2026-08-13T07:50:00.000Z',
    });
    expect(poolQuery).not.toHaveBeenCalled();
    expect(poolConnect).toHaveBeenCalledOnce();
    expect(statements[0]).toBe('begin isolation level repeatable read read only');
    expect(statements.at(-1)).toBe('commit');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
