import type { CareWarning, CreateMeasurementInput, MeasurementReceipt } from '@baby-care/contracts';
import { careFingerprint, findDuplicateWarning, validateOccurredAt } from '@baby-care/domain';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DatabaseContext } from '../db.js';
import { measurements } from '../schema.js';
import type { CareActorContext } from './care-auth.js';
import { CareConfirmationRequiredError, CareValidationError } from './care-errors.js';
import { createCareEvent, findByClientRequestId } from './care-event-repository.js';

function receipt(id: string, occurredAt: Date, status: 'active' | 'voided', kind: MeasurementReceipt['kind']): MeasurementReceipt {
  return { id, occurredAt: occurredAt.toISOString(), status, kind };
}

function canonicalValue(input: CreateMeasurementInput): number {
  return input.measurement.kind === 'temperature'
    ? input.measurement.valueCelsius
    : input.measurement.valueKg;
}

async function collectWarnings(
  database: DatabaseContext,
  actor: CareActorContext,
  input: CreateMeasurementInput,
  now: Date,
): Promise<CareWarning[]> {
  const occurredAt = new Date(input.occurredAt);
  const time = validateOccurredAt(occurredAt, now);
  if (!time.ok) throw new CareValidationError('The care time is too far in the future.');
  const warnings: CareWarning[] = [];
  if (time.warning === 'old_backfill') {
    warnings.push({ code: 'old_backfill', summary: 'This record is more than 24 hours old.' });
  }
  const value = canonicalValue(input);
  const rows = await database.pool.query<{ id: string; occurred_at: Date; measurement_type: MeasurementReceipt['kind']; value: number }>(
    `select ce.id, ce.occurred_at, m.measurement_type, m.value::float8 as value
       from care_events ce
       join measurements m on m.event_id = ce.id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and m.measurement_type = $3 and m.value = $4
        and ce.occurred_at between $5::timestamptz - interval '5 minutes' and $5::timestamptz + interval '5 minutes'`,
    [actor.familyId, actor.babyId, input.measurement.kind, value, occurredAt],
  );
  const duplicate = findDuplicateWarning(
    {
      eventType: input.measurement.kind,
      occurredAt,
      fingerprint: careFingerprint('measurement', input.measurement.kind, value),
    },
    rows.rows.map((row) => ({
      eventType: row.measurement_type,
      occurredAt: row.occurred_at,
      fingerprint: careFingerprint('measurement', row.measurement_type, row.value),
      eventId: row.id,
    })),
  );
  if (duplicate) warnings.push(duplicate);
  return warnings;
}

export function createMeasurementService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async create(actor: CareActorContext, input: CreateMeasurementInput, traceId: string): Promise<MeasurementReceipt> {
      const lookup = await database.pool.connect();
      try {
        const existing = await findByClientRequestId(lookup, actor, input.clientRequestId);
        if (existing) return receipt(existing.id, existing.occurredAt, existing.status, input.measurement.kind);
      } finally {
        lookup.release();
      }

      const warnings = await collectWarnings(database, actor, input, now());
      const confirmed = new Set(input.confirmedWarnings ?? []);
      const pending = warnings.filter((warning) => !confirmed.has(warning.code));
      if (pending.length > 0) throw new CareConfirmationRequiredError(pending);

      const occurredAt = new Date(input.occurredAt);
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await createCareEvent(client, {
          actor,
          eventType: input.measurement.kind,
          occurredAt,
          clientRequestId: input.clientRequestId,
          note: input.note ?? null,
          traceId,
        });
        const orm = drizzle({ client });
        await orm.insert(measurements).values({
          eventId: event.id,
          measurementType: input.measurement.kind,
          value: canonicalValue(input),
          method: input.measurement.kind === 'temperature' ? (input.measurement.method ?? null) : null,
        });
        await client.query('commit');
        return receipt(event.id, event.occurredAt, event.status, input.measurement.kind);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type MeasurementService = ReturnType<typeof createMeasurementService>;
