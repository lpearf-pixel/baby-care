import type pg from 'pg';
import type { CareTimelineItemDto } from '@baby-care/contracts';
import type { CareEventRow } from './care-event-repository.js';

type TimelinePayload = CareTimelineItemDto['payload'];

interface FeedingBatchRow extends pg.QueryResultRow {
  event_id: string;
  row_kind: 'component' | 'related_action';
  component_type: 'direct_breastfeeding' | 'bottle' | null;
  liquid_type: 'expressed_breast_milk' | 'formula' | null;
  amount_ml: number | null;
  duration_minutes: number | null;
  bottle_capacity_ml: number | null;
  action_type: 'burping' | 'spit_up' | null;
  spit_up_amount: 'small' | 'medium' | 'large' | null;
}

interface DiaperBatchRow extends pg.QueryResultRow {
  event_id: string;
  kind: 'urine' | 'stool' | 'urine_stool';
  stool_color: string | null;
  stool_consistency: string | null;
  stool_amount: string | null;
}

interface SleepBatchRow extends pg.QueryResultRow {
  event_id: string;
  started_at: Date;
  ended_at: Date | null;
}

interface ActionBatchRow extends pg.QueryResultRow {
  event_id: string;
  action_type: 'burping' | 'spit_up' | 'crying' | 'bathing' | 'medication';
  spit_up_amount: 'small' | 'medium' | 'large' | null;
  crying_duration_minutes: number | null;
  medication_name: string | null;
  medication_dose: number | null;
  medication_dose_unit: string | null;
}

interface MeasurementBatchRow extends pg.QueryResultRow {
  event_id: string;
  measurement_type: 'temperature' | 'weight';
  value: number;
  method: string | null;
}

function idsFor(events: readonly CareEventRow[], accepted: readonly CareEventRow['eventType'][]): string[] {
  const eventTypes = new Set(accepted);
  return events.filter((event) => eventTypes.has(event.eventType)).map((event) => event.id);
}

function feedingComponent(row: FeedingBatchRow) {
  return row.component_type === 'bottle'
    ? {
        kind: 'bottle' as const,
        liquidType: row.liquid_type!,
        amountMl: row.amount_ml!,
        ...(row.bottle_capacity_ml === null ? {} : { bottleCapacityMl: row.bottle_capacity_ml }),
      }
    : { kind: 'direct_breastfeeding' as const, durationMinutes: row.duration_minutes! };
}

function feedingAction(row: FeedingBatchRow) {
  return row.action_type === 'spit_up'
    ? { kind: 'spit_up' as const, amount: row.spit_up_amount! }
    : { kind: 'burping' as const };
}

function actionPayload(row: ActionBatchRow): TimelinePayload {
  if (row.action_type === 'spit_up') {
    return { action: { kind: 'spit_up', amount: row.spit_up_amount! } };
  }
  if (row.action_type === 'crying') {
    return {
      action: {
        kind: 'crying',
        ...(row.crying_duration_minutes === null ? {} : { durationMinutes: row.crying_duration_minutes }),
      },
    };
  }
  if (row.action_type === 'medication') {
    return {
      action: {
        kind: 'medication',
        medicationName: row.medication_name!,
        dose: row.medication_dose!,
        doseUnit: row.medication_dose_unit!,
      },
    };
  }
  return row.action_type === 'bathing'
    ? { action: { kind: 'bathing' } }
    : { action: { kind: 'burping' } };
}

export async function loadCareTimelinePayloads(
  client: pg.PoolClient,
  events: readonly CareEventRow[],
): Promise<Map<string, TimelinePayload>> {
  const payloads = new Map<string, TimelinePayload>();

  const feedingEvents = events.filter((event) => event.eventType === 'feeding');
  const feedingIds = feedingEvents.map((event) => event.id);
  if (feedingIds.length > 0) {
    const feeding = new Map<string, {
      components: Array<ReturnType<typeof feedingComponent>>;
      relatedActions: Array<ReturnType<typeof feedingAction>>;
    }>();
    for (const id of feedingIds) feeding.set(id, { components: [], relatedActions: [] });
    const result = await client.query<FeedingBatchRow>(
      `select fc.session_event_id as event_id, 'component'::text as row_kind,
              fc.occurred_at as sort_at, fc.id::text as sort_id,
              fc.component_type::text as component_type, fc.liquid_type::text as liquid_type,
              fc.amount_ml, fc.duration_minutes, fc.bottle_capacity_ml,
              null::text as action_type, null::text as spit_up_amount
         from feeding_components fc
        where fc.session_event_id = any($1::uuid[])
       union all
       select ca.feeding_session_event_id as event_id, 'related_action'::text as row_kind,
              ce.created_at as sort_at, ce.id::text as sort_id,
              null::text as component_type, null::text as liquid_type,
              null::int as amount_ml, null::int as duration_minutes, null::int as bottle_capacity_ml,
              ca.action_type::text as action_type, ca.spit_up_amount::text as spit_up_amount
         from care_actions ca
         join unnest($1::uuid[], $2::uuid[], $3::uuid[])
           as scoped(event_id, family_id, baby_id)
           on scoped.event_id = ca.feeding_session_event_id
         join care_events ce on ce.id = ca.event_id
        where ca.feeding_session_event_id = any($1::uuid[]) and ce.status = 'active'
          and ce.family_id = scoped.family_id and ce.baby_id = scoped.baby_id
          and ca.action_type in ('burping', 'spit_up')
        order by event_id, sort_at, sort_id`,
      [
        feedingIds,
        feedingEvents.map((event) => event.familyId),
        feedingEvents.map((event) => event.babyId),
      ],
    );
    for (const row of result.rows) {
      const payload = feeding.get(row.event_id);
      if (!payload) continue;
      if (row.row_kind === 'component') payload.components.push(feedingComponent(row));
      else payload.relatedActions.push(feedingAction(row));
    }
    for (const [id, payload] of feeding) payloads.set(id, payload);
  }

  const diaperIds = idsFor(events, ['diaper']);
  if (diaperIds.length > 0) {
    const result = await client.query<DiaperBatchRow>(
      `select event_id, kind, stool_color, stool_consistency, stool_amount
         from diaper_events where event_id = any($1::uuid[])`,
      [diaperIds],
    );
    for (const row of result.rows) {
      payloads.set(row.event_id, {
        kind: row.kind,
        stoolColor: row.stool_color,
        stoolConsistency: row.stool_consistency,
        stoolAmount: row.stool_amount,
      });
    }
  }

  const sleepIds = idsFor(events, ['sleep']);
  if (sleepIds.length > 0) {
    const result = await client.query<SleepBatchRow>(
      `select event_id, started_at, ended_at
         from sleep_intervals where event_id = any($1::uuid[])`,
      [sleepIds],
    );
    for (const row of result.rows) {
      payloads.set(row.event_id, {
        startedAt: row.started_at.toISOString(),
        endedAt: row.ended_at?.toISOString() ?? null,
      });
    }
  }

  const actionIds = idsFor(events, ['burping', 'spit_up', 'crying', 'bathing', 'medication']);
  if (actionIds.length > 0) {
    const result = await client.query<ActionBatchRow>(
      `select event_id, action_type, spit_up_amount, crying_duration_minutes,
              medication_name, medication_dose::float8 as medication_dose, medication_dose_unit
         from care_actions where event_id = any($1::uuid[])`,
      [actionIds],
    );
    for (const row of result.rows) payloads.set(row.event_id, actionPayload(row));
  }

  const measurementIds = idsFor(events, ['temperature', 'weight']);
  if (measurementIds.length > 0) {
    const result = await client.query<MeasurementBatchRow>(
      `select event_id, measurement_type, value::float8 as value, method
         from measurements where event_id = any($1::uuid[])`,
      [measurementIds],
    );
    for (const row of result.rows) {
      payloads.set(row.event_id, row.measurement_type === 'temperature'
        ? {
            measurement: {
              kind: 'temperature',
              valueCelsius: row.value,
              ...(row.method === null ? {} : { method: row.method }),
            },
          }
        : { measurement: { kind: 'weight', valueKg: row.value } });
    }
  }

  return payloads;
}
