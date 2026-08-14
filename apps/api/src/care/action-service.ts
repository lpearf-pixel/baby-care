import type { CareActionReceipt, CareWarning, CreateCareActionInput } from '@baby-care/contracts';
import { careFingerprint, findDuplicateWarning, validateOccurredAt } from '@baby-care/domain';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import { CareConfirmationRequiredError, CareValidationError } from './care-errors.js';
import { createCareEvent, findByClientRequestId } from './care-event-repository.js';
import { insertCareActionRow } from './care-action-repository.js';

function receipt(id: string, occurredAt: Date, status: 'active' | 'voided', kind: CareActionReceipt['kind']): CareActionReceipt {
  return { id, occurredAt: occurredAt.toISOString(), status, kind };
}

async function recentActionWarnings(
  database: DatabaseContext,
  actor: CareActorContext,
  input: CreateCareActionInput,
  now: Date,
): Promise<CareWarning[]> {
  const occurredAt = new Date(input.occurredAt);
  const time = validateOccurredAt(occurredAt, now);
  if (!time.ok) throw new CareValidationError('The care time is too far in the future.');
  const warnings: CareWarning[] = [];
  if (time.warning === 'old_backfill') {
    warnings.push({ code: 'old_backfill', summary: 'This record is more than 24 hours old.' });
  }
  const rows = await database.pool.query<{ id: string; occurred_at: Date; action_type: CareActionReceipt['kind'] }>(
    `select ce.id, ce.occurred_at, ca.action_type
       from care_events ce
       join care_actions ca on ca.event_id = ce.id
      where ce.family_id = $1 and ce.baby_id = $2 and ce.status = 'active'
        and ca.action_type = $3
        and ce.occurred_at between $4::timestamptz - interval '5 minutes' and $4::timestamptz + interval '5 minutes'`,
    [actor.familyId, actor.babyId, input.action.kind, occurredAt],
  );
  const duplicate = findDuplicateWarning(
    { eventType: input.action.kind, occurredAt, fingerprint: careFingerprint('action', input.action.kind) },
    rows.rows.map((row) => ({
      eventType: row.action_type,
      occurredAt: row.occurred_at,
      fingerprint: careFingerprint('action', row.action_type),
      eventId: row.id,
    })),
  );
  if (duplicate) warnings.push(duplicate);
  return warnings;
}

export function createActionService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async create(actor: CareActorContext, input: CreateCareActionInput, traceId: string): Promise<CareActionReceipt> {
      const lookup = await database.pool.connect();
      try {
        const existing = await findByClientRequestId(lookup, actor, input.clientRequestId);
        if (existing) return receipt(existing.id, existing.occurredAt, existing.status, input.action.kind);
      } finally {
        lookup.release();
      }

      const warnings = await recentActionWarnings(database, actor, input, now());
      const confirmed = new Set(input.confirmedWarnings ?? []);
      const pending = warnings.filter((warning) => !confirmed.has(warning.code));
      if (pending.length > 0) throw new CareConfirmationRequiredError(pending);

      const occurredAt = new Date(input.occurredAt);
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await createCareEvent(client, {
          actor,
          eventType: input.action.kind,
          occurredAt,
          clientRequestId: input.clientRequestId,
          note: input.note ?? null,
          traceId,
        });
        const action = input.action;
        await insertCareActionRow(client, {
          eventId: event.id,
          actionType: action.kind,
          feedingSessionEventId: null,
          spitUpAmount: action.kind === 'spit_up' ? action.amount : null,
          cryingDurationMinutes: action.kind === 'crying' ? (action.durationMinutes ?? null) : null,
          medicationName: action.kind === 'medication' ? action.medicationName : null,
          medicationDose: action.kind === 'medication' ? action.dose : null,
          medicationDoseUnit: action.kind === 'medication' ? action.doseUnit : null,
        });
        await client.query('commit');
        return receipt(event.id, event.occurredAt, event.status, action.kind);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type ActionService = ReturnType<typeof createActionService>;
