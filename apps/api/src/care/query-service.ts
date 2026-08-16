import type {
  CareHomeSummaryDto,
} from '@baby-care/contracts';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';

interface EventTimeRow {
  id: string;
  occurred_at: Date;
}

interface RollingRow {
  bottle_total_ml: number;
  expressed_breast_milk_ml: number;
  formula_ml: number;
  direct_breastfeeding_sessions: number;
  direct_breastfeeding_minutes: number;
}

interface LegacyCareTimelineItem {
  id: string;
  eventType: 'feeding' | 'diaper' | 'sleep' | 'burping' | 'spit_up' | 'crying' | 'bathing' | 'medication' | 'temperature' | 'weight';
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'voided';
  source: 'manual' | 'guardian' | 'device' | 'import' | 'ai';
  actorUserId: string | null;
  actorDisplayName: string | null;
  note: string | null;
}

interface LegacyCareTimelineResponse {
  items: LegacyCareTimelineItem[];
  nextCursor: null;
}

export function createQueryService(database: DatabaseContext) {
  return {
    async summary(actor: CareActorContext, asOf: Date): Promise<CareHomeSummaryDto> {
      const lastFeedResult = await database.pool.query<EventTimeRow>(
        `select id, occurred_at
           from care_events
          where family_id = $1 and baby_id = $2 and status = 'active'
            and event_type = 'feeding' and occurred_at <= $3
          order by occurred_at desc, created_at desc, id desc
          limit 1`,
        [actor.familyId, actor.babyId, asOf],
      );
      const lastFeedRow = lastFeedResult.rows[0];
      let lastFeeding: CareHomeSummaryDto['lastFeeding'] = null;
      if (lastFeedRow) {
        const bottleResult = await database.pool.query<{
          liquid_type: 'expressed_breast_milk' | 'formula';
          amount_ml: number;
        }>(
          `select liquid_type, amount_ml
             from feeding_components
            where session_event_id = $1 and component_type = 'bottle'
            order by occurred_at desc, id desc
            limit 1`,
          [lastFeedRow.id],
        );
        const directResult = await database.pool.query<{ minutes: number }>(
          `select coalesce(sum(duration_minutes), 0)::int as minutes
             from feeding_components
            where session_event_id = $1 and component_type = 'direct_breastfeeding'`,
          [lastFeedRow.id],
        );
        const bottle = bottleResult.rows[0];
        const directMinutes = directResult.rows[0]?.minutes ?? 0;
        lastFeeding = {
          occurredAt: lastFeedRow.occurred_at.toISOString(),
          ...(bottle ? { bottle: { liquidType: bottle.liquid_type, amountMl: bottle.amount_ml } } : {}),
          ...(directMinutes > 0 ? { directBreastfeedingMinutes: directMinutes } : {}),
        };
      }

      const lastDiaperResult = await database.pool.query<{
        occurred_at: Date;
        kind: 'urine' | 'stool' | 'urine_stool';
      }>(
        `select ce.occurred_at, de.kind
           from care_events ce
           join diaper_events de on de.event_id = ce.id
          where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
            and ce.event_type = 'diaper' and ce.occurred_at <= $3
          order by ce.occurred_at desc, ce.created_at desc, ce.id desc
          limit 1`,
        [actor.familyId, actor.babyId, asOf],
      );
      const lastDiaperRow = lastDiaperResult.rows[0];

      const rollingResult = await database.pool.query<RollingRow>(
        `select
           coalesce(sum(fc.amount_ml) filter (where fc.component_type = 'bottle'), 0)::int as bottle_total_ml,
           coalesce(sum(fc.amount_ml) filter (where fc.component_type = 'bottle' and fc.liquid_type = 'expressed_breast_milk'), 0)::int as expressed_breast_milk_ml,
           coalesce(sum(fc.amount_ml) filter (where fc.component_type = 'bottle' and fc.liquid_type = 'formula'), 0)::int as formula_ml,
           count(distinct fc.session_event_id) filter (where fc.component_type = 'direct_breastfeeding')::int as direct_breastfeeding_sessions,
           coalesce(sum(fc.duration_minutes) filter (where fc.component_type = 'direct_breastfeeding'), 0)::int as direct_breastfeeding_minutes
         from feeding_components fc
         join care_events ce on ce.id = fc.session_event_id
        where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
          and ce.event_type = 'feeding'
          and fc.occurred_at >= $3::timestamptz - interval '24 hours'
          and fc.occurred_at <= $3::timestamptz`,
        [actor.familyId, actor.babyId, asOf],
      );
      const rolling = rollingResult.rows[0] ?? {
        bottle_total_ml: 0,
        expressed_breast_milk_ml: 0,
        formula_ml: 0,
        direct_breastfeeding_sessions: 0,
        direct_breastfeeding_minutes: 0,
      };

      const openSleepResult = await database.pool.query<{ event_id: string; started_at: Date }>(
        `select si.event_id, si.started_at
           from sleep_intervals si
           join care_events ce on ce.id = si.event_id
          where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
            and ce.event_type = 'sleep' and si.ended_at is null and si.started_at <= $3
          order by si.started_at desc, ce.created_at desc, ce.id desc
          limit 2`,
        [actor.familyId, actor.babyId, asOf],
      );
      const currentSleep = openSleepResult.rows.length === 1
        ? {
            intervalId: openSleepResult.rows[0]!.event_id,
            startedAt: openSleepResult.rows[0]!.started_at.toISOString(),
          }
        : null;

      return {
        asOf: asOf.toISOString(),
        lastFeeding,
        lastDiaper: lastDiaperRow
          ? { occurredAt: lastDiaperRow.occurred_at.toISOString(), kind: lastDiaperRow.kind }
          : null,
        rolling24h: {
          bottleTotalMl: rolling.bottle_total_ml,
          expressedBreastMilkMl: rolling.expressed_breast_milk_ml,
          formulaMl: rolling.formula_ml,
          directBreastfeedingSessions: rolling.direct_breastfeeding_sessions,
          directBreastfeedingMinutes: rolling.direct_breastfeeding_minutes,
        },
        currentSleep,
      };
    },

    async timeline(actor: CareActorContext, before: Date, limit: number): Promise<LegacyCareTimelineResponse> {
      const result = await database.pool.query<{
        id: string;
        event_type: LegacyCareTimelineItem['eventType'];
        occurred_at: Date;
        created_at: Date;
        updated_at: Date;
        status: LegacyCareTimelineItem['status'];
        source: LegacyCareTimelineItem['source'];
        actor_user_id: string | null;
        actor_display_name: string | null;
        note: string | null;
      }>(
        `select ce.id, ce.event_type, ce.occurred_at, ce.created_at, ce.updated_at,
                ce.status, ce.source, ce.actor_user_id, u.display_name as actor_display_name, ce.note
           from care_events ce
           left join users u on u.id = ce.actor_user_id
          where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
            and ce.occurred_at <= $3
          order by ce.occurred_at desc, ce.created_at desc, ce.id desc
          limit $4`,
        [actor.familyId, actor.babyId, before, limit],
      );
      return {
        items: result.rows.map((row) => ({
          id: row.id,
          eventType: row.event_type,
          occurredAt: row.occurred_at.toISOString(),
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          status: row.status,
          source: row.source,
          actorUserId: row.actor_user_id,
          actorDisplayName: row.actor_display_name,
          note: row.note,
        })),
        nextCursor: null,
      };
    },
  };
}

export type QueryService = ReturnType<typeof createQueryService>;
