import type pg from 'pg';
import type { BottleLiquidType } from '@baby-care/contracts';
import type { BottleAmountHistory } from '@baby-care/domain';
import type { CareActorContext } from './care-auth.js';

export async function recentBottleHistory(pool: pg.Pool, actor: CareActorContext, liquidType: BottleLiquidType): Promise<BottleAmountHistory[]> {
  const result = await pool.query<{ amount_ml: number; occurred_at: Date }>(
    `select fc.amount_ml, fc.occurred_at from feeding_components fc join care_events ce on ce.id = fc.session_event_id where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active' and fc.amount_ml is not null and fc.liquid_type = $3 order by fc.occurred_at desc limit 20`,
    [actor.familyId, actor.babyId, liquidType],
  );
  return result.rows.map((row) => ({ amountMl: row.amount_ml, occurredAt: row.occurred_at }));
}
