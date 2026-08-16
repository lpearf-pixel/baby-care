import type { CreateDiaperInput, DiaperEventDto, CareWarning } from '@baby-care/contracts';
import { careFingerprint, findDuplicateWarning, validateOccurredAt } from '@baby-care/domain';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import { CareConfirmationRequiredError, CareValidationError } from './care-errors.js';
import { createCareEvent, findByClientRequestId } from './care-event-repository.js';

interface DiaperRow {
  id: string;
  occurred_at: Date;
  status: 'active' | 'voided';
  note: string | null;
  kind: 'urine' | 'stool' | 'urine_stool';
  stool_color: string | null;
  stool_consistency: string | null;
  stool_amount: string | null;
}

function toDto(row: DiaperRow): DiaperEventDto {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    status: row.status,
    kind: row.kind,
    stoolColor: row.stool_color,
    stoolConsistency: row.stool_consistency,
    stoolAmount: row.stool_amount,
    note: row.note,
  };
}

async function loadDiaper(database: DatabaseContext, actor: CareActorContext, eventId: string): Promise<DiaperEventDto | null> {
  const result = await database.pool.query<DiaperRow>(
    `select ce.id, ce.occurred_at, ce.status, ce.note,
            de.kind, de.stool_color, de.stool_consistency, de.stool_amount
       from care_events ce
       join diaper_events de on de.event_id = ce.id
      where ce.id = $1 and ce.family_id = $2 and ce.baby_id = $3
      limit 1`,
    [eventId, actor.familyId, actor.babyId],
  );
  return result.rows[0] ? toDto(result.rows[0]) : null;
}

async function collectWarnings(
  database: DatabaseContext,
  actor: CareActorContext,
  input: CreateDiaperInput,
  now: Date,
): Promise<CareWarning[]> {
  const time = validateOccurredAt(new Date(input.occurredAt), now);
  if (!time.ok) throw new CareValidationError('The care time is too far in the future.');
  const warnings: CareWarning[] = [];
  if (time.warning === 'old_backfill') {
    warnings.push({ code: 'old_backfill', summary: 'This record is more than 24 hours old.' });
  }

  const occurredAt = new Date(input.occurredAt);
  const recent = await database.pool.query<{ id: string; occurred_at: Date; kind: CreateDiaperInput['kind'] }>(
    `select ce.id, ce.occurred_at, de.kind
       from care_events ce
       join diaper_events de on de.event_id = ce.id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and ce.event_type = 'diaper'
        and ce.occurred_at between $3::timestamptz - interval '5 minutes' and $3::timestamptz + interval '5 minutes'`,
    [actor.familyId, actor.babyId, occurredAt],
  );
  const duplicate = findDuplicateWarning(
    { eventType: 'diaper', occurredAt, fingerprint: careFingerprint('diaper', input.kind) },
    recent.rows.map((row) => ({
      eventType: 'diaper',
      occurredAt: row.occurred_at,
      fingerprint: careFingerprint('diaper', row.kind),
      eventId: row.id,
    })),
  );
  if (duplicate) warnings.push(duplicate);
  return warnings;
}

export function createDiaperService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async create(actor: CareActorContext, input: CreateDiaperInput, traceId: string): Promise<DiaperEventDto> {
      const lookup = await database.pool.connect();
      try {
        const existing = await findByClientRequestId(lookup, actor, input.clientRequestId);
        if (existing) {
          const dto = await loadDiaper(database, actor, existing.id);
          if (dto) return dto;
        }
      } finally {
        lookup.release();
      }

      const warnings = await collectWarnings(database, actor, input, now());
      const confirmed = new Set(input.confirmedWarnings ?? []);
      const pending = warnings.filter((warning) => !confirmed.has(warning.code));
      if (pending.length > 0) throw new CareConfirmationRequiredError(pending);

      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await createCareEvent(client, {
          actor,
          eventType: 'diaper',
          occurredAt: new Date(input.occurredAt),
          clientRequestId: input.clientRequestId,
          note: input.note ?? null,
          traceId,
        });
        await client.query(
          `insert into diaper_events (event_id, kind, stool_color, stool_consistency, stool_amount)
           values ($1,$2,$3,$4,$5) on conflict (event_id) do nothing`,
          [event.id, input.kind, input.stoolColor ?? null, input.stoolConsistency ?? null, input.stoolAmount ?? null],
        );
        await client.query('commit');
        const dto = await loadDiaper(database, actor, event.id);
        if (!dto) throw new Error('diaper record was not persisted');
        return dto;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type DiaperService = ReturnType<typeof createDiaperService>;
