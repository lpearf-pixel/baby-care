import type pg from 'pg';
import type { CareEventRow } from './care-event-repository.js';

function withNote<T extends Record<string, unknown>>(value: T, note: string | null): T & { note?: string } {
  return note === null ? value : { ...value, note };
}

export async function loadCareSnapshot(
  client: pg.PoolClient,
  event: CareEventRow,
): Promise<Record<string, unknown>> {
  if (event.eventType === 'feeding') {
    const components = await client.query<{
      component_type: 'direct_breastfeeding' | 'bottle';
      liquid_type: 'expressed_breast_milk' | 'formula' | null;
      amount_ml: number | null;
      duration_minutes: number | null;
      bottle_capacity_ml: number | null;
    }>(
      `select component_type, liquid_type, amount_ml, duration_minutes, bottle_capacity_ml
         from feeding_components
        where session_event_id = $1
        order by occurred_at, id`,
      [event.id],
    );
    const related = await client.query<{
      action_type: 'burping' | 'spit_up';
      spit_up_amount: 'small' | 'medium' | 'large' | null;
    }>(
      `select ca.action_type, ca.spit_up_amount
         from care_actions ca
         join care_events ce on ce.id = ca.event_id
        where ca.feeding_session_event_id = $1 and ce.status = 'active'
        order by ce.created_at, ce.id`,
      [event.id],
    );
    return withNote({
      eventType: 'feeding',
      occurredAt: event.occurredAt.toISOString(),
      components: components.rows.map((row) => row.component_type === 'bottle'
        ? {
            kind: 'bottle',
            liquidType: row.liquid_type,
            amountMl: row.amount_ml,
            ...(row.bottle_capacity_ml === null ? {} : { bottleCapacityMl: row.bottle_capacity_ml }),
          }
        : { kind: 'direct_breastfeeding', durationMinutes: row.duration_minutes }),
      relatedActions: related.rows.map((row) => row.action_type === 'spit_up'
        ? { kind: 'spit_up', amount: row.spit_up_amount }
        : { kind: 'burping' }),
    }, event.note);
  }

  if (event.eventType === 'diaper') {
    const result = await client.query<{
      kind: 'urine' | 'stool' | 'urine_stool';
      stool_color: string | null;
      stool_consistency: string | null;
      stool_amount: string | null;
    }>(`select kind, stool_color, stool_consistency, stool_amount from diaper_events where event_id = $1`, [event.id]);
    const row = result.rows[0];
    return withNote({
      eventType: 'diaper',
      occurredAt: event.occurredAt.toISOString(),
      kind: row?.kind,
      ...(row?.stool_color ? { stoolColor: row.stool_color } : {}),
      ...(row?.stool_consistency ? { stoolConsistency: row.stool_consistency } : {}),
      ...(row?.stool_amount ? { stoolAmount: row.stool_amount } : {}),
    }, event.note);
  }

  if (event.eventType === 'sleep') {
    const result = await client.query<{ started_at: Date; ended_at: Date | null }>(
      `select started_at, ended_at from sleep_intervals where event_id = $1`,
      [event.id],
    );
    const row = result.rows[0];
    return withNote({
      eventType: 'sleep',
      startedAt: row?.started_at.toISOString(),
      endedAt: row?.ended_at?.toISOString() ?? null,
    }, event.note);
  }

  if (event.eventType === 'temperature' || event.eventType === 'weight') {
    const result = await client.query<{ measurement_type: 'temperature' | 'weight'; value: number; method: string | null }>(
      `select measurement_type, value::float8 as value, method from measurements where event_id = $1`,
      [event.id],
    );
    const row = result.rows[0];
    return withNote({
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      measurement: row?.measurement_type === 'temperature'
        ? { kind: 'temperature', valueCelsius: row.value, ...(row.method ? { method: row.method } : {}) }
        : { kind: 'weight', valueKg: row?.value },
    }, event.note);
  }

  const result = await client.query<{
    action_type: 'burping' | 'spit_up' | 'crying' | 'bathing' | 'medication';
    spit_up_amount: 'small' | 'medium' | 'large' | null;
    crying_duration_minutes: number | null;
    medication_name: string | null;
    medication_dose: number | null;
    medication_dose_unit: string | null;
  }>(
    `select action_type, spit_up_amount, crying_duration_minutes,
            medication_name, medication_dose::float8 as medication_dose, medication_dose_unit
       from care_actions where event_id = $1`,
    [event.id],
  );
  const row = result.rows[0];
  let action: Record<string, unknown> = { kind: row?.action_type };
  if (row?.action_type === 'spit_up') action = { kind: 'spit_up', amount: row.spit_up_amount };
  if (row?.action_type === 'crying') action = {
    kind: 'crying',
    ...(row.crying_duration_minutes === null ? {} : { durationMinutes: row.crying_duration_minutes }),
  };
  if (row?.action_type === 'medication') action = {
    kind: 'medication',
    medicationName: row.medication_name,
    dose: row.medication_dose,
    doseUnit: row.medication_dose_unit,
  };
  return withNote({ eventType: event.eventType, occurredAt: event.occurredAt.toISOString(), action }, event.note);
}
