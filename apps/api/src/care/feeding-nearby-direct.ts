import type pg from 'pg';
import type { CareActorContext } from './care-auth.js';

export async function findNearbyDirectEvent(
  pool: pg.Pool,
  actor: CareActorContext,
  occurredAt: Date,
  durationMinutes: number,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `select ce.id
       from care_events ce join feeding_components fc on fc.session_event_id = ce.id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and fc.duration_minutes = $3 and fc.amount_ml is null
        and fc.occurred_at between $4::timestamptz - interval '5 minutes'
                               and $4::timestamptz + interval '5 minutes'
      order by abs(extract(epoch from (fc.occurred_at - $4::timestamptz))) asc
      limit 1`,
    [actor.familyId, actor.babyId, durationMinutes, occurredAt],
  );
  return result.rows[0]?.id ?? null;
}
