import type pg from 'pg';
import type { BottleLiquidType } from '@baby-care/contracts';
import type { CareActorContext } from './care-auth.js';

export async function findNearbyBottleEvent(
  pool: pg.Pool,
  actor: CareActorContext,
  occurredAt: Date,
  liquidType: BottleLiquidType,
  amountMl: number,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `select ce.id
       from care_events ce join feeding_components fc on fc.session_event_id = ce.id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and fc.liquid_type = $3 and fc.amount_ml = $4
        and fc.occurred_at between $5::timestamptz - interval '5 minutes'
                               and $5::timestamptz + interval '5 minutes'
      order by abs(extract(epoch from (fc.occurred_at - $5::timestamptz))) asc
      limit 1`,
    [actor.familyId, actor.babyId, liquidType, amountMl, occurredAt],
  );
  return result.rows[0]?.id ?? null;
}
