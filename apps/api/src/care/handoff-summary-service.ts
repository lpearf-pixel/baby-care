import type {
  CareHandoffBriefingDto,
  CareTimelineItemDto,
} from '@baby-care/contracts';
import { CareHandoffBriefingDtoSchema } from '@baby-care/contracts';
import type pg from 'pg';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import {
  checkpointDto,
  findHandoffById,
  findLatestHandoff,
  findPreviousHandoff,
  type HandoffCheckpointRow,
} from './handoff-repository.js';
import { createQueryService, inReadSnapshot } from './query-service.js';

const ROLLING_DAY_MS = 24 * 60 * 60 * 1000;

interface FeedingSummaryRow {
  bottle_total_ml: number;
  expressed_breast_milk_ml: number;
  formula_ml: number;
  direct_breastfeeding_sessions: number;
  direct_breastfeeding_minutes: number;
}

interface DiaperSummaryRow {
  urine: number;
  stool: number;
  urine_stool: number;
}

interface SleepSummaryRow {
  intervals: number;
  completed_minutes: number;
}

interface ActorActivityRow {
  actor_user_id: string | null;
  actor_display_name: string | null;
  event_count: number;
}

interface CorrectionRow {
  event_id: string;
  revision_action: 'edit' | 'void';
  actor_display_name: string;
  created_at: Date;
}

export class CareHandoffNotFoundError extends Error {
  constructor() {
    super('Care handoff was not found.');
    this.name = 'CareHandoffNotFoundError';
  }
}

function boundaryClause(column: string, hasPrevious: boolean): string {
  return `${column} ${hasPrevious ? '>' : '>='} $3 and ${column} <= $4`;
}

async function buildBriefing(
  database: DatabaseContext,
  client: pg.PoolClient,
  actor: CareActorContext,
  checkpoint: HandoffCheckpointRow,
): Promise<CareHandoffBriefingDto> {
  const previous = await findPreviousHandoff(client, actor, checkpoint);
  const to = checkpoint.occurred_at;
  const from = previous?.occurred_at ?? new Date(to.getTime() - ROLLING_DAY_MS);
  const hasPrevious = previous !== null;
  const eventBoundary = boundaryClause('ce.occurred_at', hasPrevious);
  const componentBoundary = boundaryClause('fc.occurred_at', hasPrevious);
  const values = [actor.familyId, actor.babyId, from, to];
  const queryService = createQueryService(database);

  const [careState, timeline, feedingResult, diaperResult, sleepResult, countResult, actorResult, correctionResult] = await Promise.all([
    queryService.summary(actor, to, client),
    queryService.timeline(actor, {
      from: from.toISOString(),
      to: to.toISOString(),
      category: 'all',
      limit: 20,
    }, client),
    client.query<FeedingSummaryRow>(
      `select
         coalesce(sum(fc.amount_ml) filter (where fc.component_type = 'bottle'), 0)::int as bottle_total_ml,
         coalesce(sum(fc.amount_ml) filter (
           where fc.component_type = 'bottle' and fc.liquid_type = 'expressed_breast_milk'
         ), 0)::int as expressed_breast_milk_ml,
         coalesce(sum(fc.amount_ml) filter (
           where fc.component_type = 'bottle' and fc.liquid_type = 'formula'
         ), 0)::int as formula_ml,
         count(distinct fc.session_event_id) filter (
           where fc.component_type = 'direct_breastfeeding'
         )::int as direct_breastfeeding_sessions,
         coalesce(sum(fc.duration_minutes) filter (
           where fc.component_type = 'direct_breastfeeding'
         ), 0)::int as direct_breastfeeding_minutes
       from feeding_components fc
       join care_events ce on ce.id = fc.session_event_id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and ce.event_type = 'feeding' and ${componentBoundary}`,
      values,
    ),
    client.query<DiaperSummaryRow>(
      `select
         count(*) filter (where de.kind = 'urine')::int as urine,
         count(*) filter (where de.kind = 'stool')::int as stool,
         count(*) filter (where de.kind = 'urine_stool')::int as urine_stool
       from diaper_events de
       join care_events ce on ce.id = de.event_id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and ce.event_type = 'diaper' and ${eventBoundary}`,
      values,
    ),
    client.query<SleepSummaryRow>(
      `select
         count(*)::int as intervals,
         coalesce(floor(sum(extract(epoch from (
           least(si.ended_at, $4::timestamptz) - greatest(si.started_at, $3::timestamptz)
         ))) / 60), 0)::int as completed_minutes
       from sleep_intervals si
       join care_events ce on ce.id = si.event_id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and ce.event_type = 'sleep' and si.ended_at is not null
        and si.started_at <= $4 and si.ended_at > $3`,
      values,
    ),
    client.query<{ count: number }>(
      `select count(*)::int as count from care_events ce
        where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
          and ${eventBoundary}`,
      values,
    ),
    client.query<ActorActivityRow>(
      `select ce.actor_user_id, u.display_name as actor_display_name, count(*)::int as event_count
         from care_events ce
         left join users u on u.id = ce.actor_user_id
        where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
          and ${eventBoundary}
        group by ce.actor_user_id, u.display_name
        order by count(*) desc, u.display_name nulls last, ce.actor_user_id`,
      values,
    ),
    client.query<CorrectionRow>(
      `select cr.event_id, cr.revision_action, u.display_name as actor_display_name, cr.created_at
         from care_event_revisions cr
         join care_events ce on ce.id = cr.event_id
         join users u on u.id = cr.edit_actor_user_id
        where ce.family_id = $1 and ce.baby_id = $2 and ${eventBoundary}
        order by cr.created_at desc, cr.id desc`,
      values,
    ),
  ]);

  const feeding = feedingResult.rows[0] ?? {
    bottle_total_ml: 0,
    expressed_breast_milk_ml: 0,
    formula_ml: 0,
    direct_breastfeeding_sessions: 0,
    direct_breastfeeding_minutes: 0,
  };
  const diapers = diaperResult.rows[0] ?? { urine: 0, stool: 0, urine_stool: 0 };
  const sleep = sleepResult.rows[0] ?? { intervals: 0, completed_minutes: 0 };
  const notableEvents = hasPrevious
    ? timeline.items.filter((item) => new Date(item.occurredAt).getTime() > from.getTime())
    : timeline.items;

  return CareHandoffBriefingDtoSchema.parse({
    checkpoint: checkpointDto(checkpoint),
    previousCheckpoint: previous ? checkpointDto(previous) : null,
    window: {
      mode: hasPrevious ? 'checkpoint' : 'rolling_24h',
      from: from.toISOString(),
      to: to.toISOString(),
    },
    careState,
    feeding: {
      bottleTotalMl: feeding.bottle_total_ml,
      expressedBreastMilkMl: feeding.expressed_breast_milk_ml,
      formulaMl: feeding.formula_ml,
      directBreastfeedingSessions: feeding.direct_breastfeeding_sessions,
      directBreastfeedingMinutes: feeding.direct_breastfeeding_minutes,
    },
    diapers: { urine: diapers.urine, stool: diapers.stool, urineStool: diapers.urine_stool },
    sleep: { intervals: sleep.intervals, completedMinutes: sleep.completed_minutes },
    notableEvents: notableEvents as CareTimelineItemDto[],
    notableEventCount: countResult.rows[0]?.count ?? 0,
    actorActivity: actorResult.rows.map((row) => ({
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      eventCount: row.event_count,
    })),
    corrections: correctionResult.rows.map((row) => ({
      eventId: row.event_id,
      action: row.revision_action,
      actorDisplayName: row.actor_display_name,
      createdAt: row.created_at.toISOString(),
    })),
    correctionCount: correctionResult.rows.length,
  });
}

export function createHandoffSummaryService(database: DatabaseContext) {
  return {
    async latest(actor: CareActorContext): Promise<CareHandoffBriefingDto | null> {
      return inReadSnapshot(database, async (client) => {
        const checkpoint = await findLatestHandoff(client, actor);
        return checkpoint ? buildBriefing(database, client, actor, checkpoint) : null;
      });
    },

    async byId(actor: CareActorContext, handoffId: string): Promise<CareHandoffBriefingDto> {
      return inReadSnapshot(database, async (client) => {
        const checkpoint = await findHandoffById(client, actor, handoffId);
        if (!checkpoint) throw new CareHandoffNotFoundError();
        return buildBriefing(database, client, actor, checkpoint);
      });
    },
  };
}

export type HandoffSummaryService = ReturnType<typeof createHandoffSummaryService>;
