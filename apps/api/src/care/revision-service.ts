import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  CareRevisionReceipt,
  EditCareEventInput,
  UndoCareEventResponse,
} from '@baby-care/contracts';
import { validateOccurredAt } from '@baby-care/domain';
import { writeAudit } from '../audit/audit-repository.js';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';
import { insertCareActionRow } from './care-action-repository.js';
import {
  appendCareRevision,
  createCareEvent,
  loadActiveCareEventForUpdate,
  type CareEventRow,
  voidCareEvent,
} from './care-event-repository.js';
import { CareEventNotFoundError, CareStateConflictError, CareValidationError } from './care-errors.js';
import { replaceFeedingComponents } from './feeding-persistence.js';
import { loadCareSnapshot } from './revision-snapshot.js';

function rejectFuture(value: string, now: Date): void {
  const result = validateOccurredAt(new Date(value), now);
  if (!result.ok) throw new CareValidationError('The care time is too far in the future.');
}

function eventOccurredAt(input: EditCareEventInput): Date {
  return new Date(input.eventType === 'sleep' ? input.startedAt : input.occurredAt);
}

function inputSnapshot(input: EditCareEventInput): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

async function auditRevision(
  client: pg.PoolClient,
  actor: CareActorContext,
  event: Pick<CareEventRow, 'id' | 'eventType' | 'source'>,
  action: 'care.event_edited' | 'care.event_voided',
  traceId: string,
): Promise<void> {
  await writeAudit(client, {
    familyId: actor.familyId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    action,
    targetType: 'care_event',
    targetId: event.id,
    source: 'api',
    traceId,
    metadata: { eventType: event.eventType, careSource: event.source },
  });
}

async function updateEventEnvelope(
  client: pg.PoolClient,
  event: CareEventRow,
  occurredAt: Date,
  note: string | undefined,
  updatedAt: Date,
): Promise<void> {
  await client.query(
    `update care_events
        set occurred_at = $2, note = $3, updated_at = $4, version = version + 1
      where id = $1`,
    [event.id, occurredAt, note ?? null, updatedAt],
  );
}

async function voidLinkedActions(
  client: pg.PoolClient,
  actor: CareActorContext,
  feedingEventId: string,
  now: Date,
  traceId: string,
): Promise<void> {
  const linked = await client.query<{ id: string }>(
    `select ce.id
       from care_events ce
       join care_actions ca on ca.event_id = ce.id
      where ca.feeding_session_event_id = $1
        and ce.family_id = $2 and ce.baby_id = $3 and ce.status = 'active'
      order by ce.id
      for update of ce`,
    [feedingEventId, actor.familyId, actor.babyId],
  );
  for (const row of linked.rows) {
    const event = await loadActiveCareEventForUpdate(client, actor, row.id);
    if (!event) continue;
    const before = await loadCareSnapshot(client, event);
    const voided = await voidCareEvent(client, { eventId: event.id, actor, updatedAt: now });
    if (!voided) continue;
    await appendCareRevision(client, {
      eventId: event.id,
      actor,
      action: 'void',
      before,
      after: { status: 'voided' },
      traceId,
    });
    await auditRevision(client, actor, event, 'care.event_voided', traceId);
  }
}

async function createLinkedActions(
  client: pg.PoolClient,
  actor: CareActorContext,
  feedingEventId: string,
  input: Extract<EditCareEventInput, { eventType: 'feeding' }>,
  traceId: string,
): Promise<void> {
  const occurredAt = new Date(input.occurredAt);
  for (const action of input.relatedActions ?? []) {
    const child = await createCareEvent(client, {
      actor,
      eventType: action.kind,
      occurredAt,
      clientRequestId: randomUUID(),
      traceId,
    });
    await insertCareActionRow(client, {
      eventId: child.id,
      actionType: action.kind,
      feedingSessionEventId: feedingEventId,
      ...('amount' in action ? { spitUpAmount: action.amount } : {}),
    });
  }
}

async function applyEditPayload(
  client: pg.PoolClient,
  actor: CareActorContext,
  event: CareEventRow,
  input: EditCareEventInput,
  updatedAt: Date,
  traceId: string,
): Promise<void> {
  if (input.eventType === 'feeding') {
    await updateEventEnvelope(client, event, new Date(input.occurredAt), input.note, updatedAt);
    await replaceFeedingComponents(client, event.id, new Date(input.occurredAt), input.components);
    await voidLinkedActions(client, actor, event.id, updatedAt, traceId);
    await createLinkedActions(client, actor, event.id, input, traceId);
    return;
  }

  if (input.eventType === 'diaper') {
    await updateEventEnvelope(client, event, new Date(input.occurredAt), input.note, updatedAt);
    await client.query(
      `update diaper_events
          set kind = $2, stool_color = $3, stool_consistency = $4, stool_amount = $5
        where event_id = $1`,
      [event.id, input.kind, input.stoolColor ?? null, input.stoolConsistency ?? null, input.stoolAmount ?? null],
    );
    return;
  }

  if (input.eventType === 'sleep') {
    await updateEventEnvelope(client, event, new Date(input.startedAt), input.note, updatedAt);
    await client.query(
      `update sleep_intervals set started_at = $2, ended_at = $3 where event_id = $1`,
      [event.id, new Date(input.startedAt), input.endedAt ? new Date(input.endedAt) : null],
    );
    return;
  }

  if (input.eventType === 'temperature' || input.eventType === 'weight') {
    await updateEventEnvelope(client, event, new Date(input.occurredAt), input.note, updatedAt);
    const value = input.measurement.kind === 'temperature'
      ? input.measurement.valueCelsius
      : input.measurement.valueKg;
    const method = input.measurement.kind === 'temperature' ? (input.measurement.method ?? null) : null;
    await client.query(
      `update measurements set measurement_type = $2, value = $3, method = $4 where event_id = $1`,
      [event.id, input.measurement.kind, value, method],
    );
    return;
  }

  await updateEventEnvelope(client, event, new Date(input.occurredAt), input.note, updatedAt);
  const action = input.action;
  await client.query(
    `update care_actions
        set action_type = $2,
            spit_up_amount = $3,
            crying_duration_minutes = $4,
            medication_name = $5,
            medication_dose = $6,
            medication_dose_unit = $7
      where event_id = $1`,
    [
      event.id,
      action.kind,
      action.kind === 'spit_up' ? action.amount : null,
      action.kind === 'crying' ? (action.durationMinutes ?? null) : null,
      action.kind === 'medication' ? action.medicationName : null,
      action.kind === 'medication' ? action.dose : null,
      action.kind === 'medication' ? action.doseUnit : null,
    ],
  );
}

export function createRevisionService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async edit(
      actor: CareActorContext,
      eventId: string,
      input: EditCareEventInput,
      traceId: string,
    ): Promise<CareRevisionReceipt> {
      const currentTime = now();
      if (input.eventType === 'sleep') {
        rejectFuture(input.startedAt, currentTime);
        if (input.endedAt) rejectFuture(input.endedAt, currentTime);
      } else {
        rejectFuture(input.occurredAt, currentTime);
      }

      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await loadActiveCareEventForUpdate(client, actor, eventId);
        if (!event) throw new CareEventNotFoundError();
        if (event.eventType !== input.eventType) {
          throw new CareStateConflictError('The edit type does not match the stored event type.');
        }
        const before = await loadCareSnapshot(client, event);
        await applyEditPayload(client, actor, event, input, currentTime, traceId);
        await appendCareRevision(client, {
          eventId,
          actor,
          action: 'edit',
          before,
          after: inputSnapshot(input),
          traceId,
        });
        await auditRevision(client, actor, event, 'care.event_edited', traceId);
        await client.query('commit');
        return { id: eventId, eventType: event.eventType, status: 'active', version: event.version + 1 };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async undo(actor: CareActorContext, eventId: string, traceId: string): Promise<UndoCareEventResponse> {
      const currentTime = now();
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const event = await loadActiveCareEventForUpdate(client, actor, eventId);
        if (!event) throw new CareEventNotFoundError();
        const before = await loadCareSnapshot(client, event);
        if (event.eventType === 'feeding') {
          await voidLinkedActions(client, actor, event.id, currentTime, traceId);
        }
        const voided = await voidCareEvent(client, { eventId, actor, updatedAt: currentTime });
        if (!voided) throw new CareEventNotFoundError();
        await appendCareRevision(client, {
          eventId,
          actor,
          action: 'void',
          before,
          after: { status: 'voided' },
          traceId,
        });
        await auditRevision(client, actor, event, 'care.event_voided', traceId);
        await client.query('commit');
        return { id: eventId, status: 'voided' };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type RevisionService = ReturnType<typeof createRevisionService>;
