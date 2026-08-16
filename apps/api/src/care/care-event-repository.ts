import type pg from 'pg';
import type { CareEventType, CareSource } from '@baby-care/contracts';
import { writeAudit } from '../audit/audit-repository.js';
import type { CareActorContext } from './care-auth.js';
import { CareEventNotFoundError, CareStateConflictError } from './care-errors.js';

export interface CareEventRow {
  id: string;
  familyId: string;
  babyId: string;
  actorUserId: string | null;
  actorMembershipId: string | null;
  source: CareSource;
  eventType: CareEventType;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'voided';
  version: number;
  clientRequestId: string | null;
  note: string | null;
  traceId: string;
}

interface CareEventDbRow {
  id: string;
  family_id: string;
  baby_id: string;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  source: CareSource;
  event_type: CareEventType;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
  status: 'active' | 'voided';
  version: number;
  client_request_id: string | null;
  note: string | null;
  trace_id: string;
}

const CARE_EVENT_COLUMNS = `
  id, family_id, baby_id, actor_user_id, actor_membership_id,
  source, event_type, occurred_at, created_at, updated_at,
  status, version, client_request_id, note, trace_id`;

function toCareEventRow(row: CareEventDbRow): CareEventRow {
  return {
    id: row.id,
    familyId: row.family_id,
    babyId: row.baby_id,
    actorUserId: row.actor_user_id,
    actorMembershipId: row.actor_membership_id,
    source: row.source,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    version: row.version,
    clientRequestId: row.client_request_id,
    note: row.note,
    traceId: row.trace_id,
  };
}

export interface CreateCareEventInput {
  actor: CareActorContext;
  eventType: CareEventType;
  occurredAt: Date;
  clientRequestId: string;
  note?: string | null;
  traceId: string;
}

export async function findByClientRequestId(
  client: pg.PoolClient,
  actor: CareActorContext,
  clientRequestId: string,
): Promise<CareEventRow | null> {
  const result = await client.query<CareEventDbRow>(
    `select ${CARE_EVENT_COLUMNS}
       from care_events
      where family_id = $1
        and baby_id = $2
        and actor_user_id = $3
        and actor_membership_id = $4
        and client_request_id = $5
      limit 1`,
    [actor.familyId, actor.babyId, actor.userId, actor.membershipId, clientRequestId],
  );
  return result.rows[0] ? toCareEventRow(result.rows[0]) : null;
}

export async function createCareEvent(
  client: pg.PoolClient,
  input: CreateCareEventInput,
): Promise<CareEventRow> {
  const result = await client.query<CareEventDbRow>(
    `insert into care_events (
       family_id, baby_id, actor_user_id, actor_membership_id,
       source, event_type, occurred_at, client_request_id, note, trace_id
     ) values ($1,$2,$3,$4,'manual',$5,$6,$7,$8,$9)
     on conflict (family_id, actor_user_id, client_request_id)
       where client_request_id is not null
     do nothing
     returning ${CARE_EVENT_COLUMNS}`,
    [
      input.actor.familyId,
      input.actor.babyId,
      input.actor.userId,
      input.actor.membershipId,
      input.eventType,
      input.occurredAt,
      input.clientRequestId,
      input.note ?? null,
      input.traceId,
    ],
  );

  const inserted = result.rows[0];
  if (inserted) {
    const event = toCareEventRow(inserted);
    await writeAudit(client, {
      familyId: input.actor.familyId,
      actorUserId: input.actor.userId,
      actorMembershipId: input.actor.membershipId,
      action: 'care.event_created',
      targetType: 'care_event',
      targetId: event.id,
      source: 'api',
      traceId: input.traceId,
      metadata: { eventType: input.eventType, careSource: 'manual' },
    });
    return event;
  }

  const existing = await findByClientRequestId(client, input.actor, input.clientRequestId);
  if (existing) return existing;
  throw new CareStateConflictError('The idempotent care write could not be resolved.');
}

export async function loadActiveCareEventForUpdate(
  client: pg.PoolClient,
  actor: CareActorContext,
  eventId: string,
): Promise<CareEventRow | null> {
  const result = await client.query<CareEventDbRow>(
    `select ${CARE_EVENT_COLUMNS}
       from care_events
      where id = $1
        and family_id = $2
        and baby_id = $3
        and status = 'active'
      for update`,
    [eventId, actor.familyId, actor.babyId],
  );
  return result.rows[0] ? toCareEventRow(result.rows[0]) : null;
}

export async function loadCareEventForUpdate(
  client: pg.PoolClient,
  actor: CareActorContext,
  eventId: string,
): Promise<CareEventRow | null> {
  const result = await client.query<CareEventDbRow>(
    `select ${CARE_EVENT_COLUMNS}
       from care_events
      where id = $1 and family_id = $2 and baby_id = $3
      for update`,
    [eventId, actor.familyId, actor.babyId],
  );
  return result.rows[0] ? toCareEventRow(result.rows[0]) : null;
}

export function assertExpectedCareEventVersion(event: CareEventRow, expectedVersion: number): void {
  if (event.version !== expectedVersion) {
    throw new CareStateConflictError('The care event has changed since it was loaded.');
  }
}

export interface AppendCareRevisionInput {
  eventId: string;
  actor: CareActorContext;
  action: 'edit' | 'void';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  traceId: string;
}

export async function appendCareRevision(
  client: pg.PoolClient,
  input: AppendCareRevisionInput,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `insert into care_event_revisions (
       event_id, edit_actor_user_id, edit_actor_membership_id,
       revision_action, before_json, after_json, trace_id
     )
     select ce.id, $4, $5, $6, $7, $8, $9
       from care_events ce
      where ce.id = $1 and ce.family_id = $2 and ce.baby_id = $3
     returning id`,
    [
      input.eventId,
      input.actor.familyId,
      input.actor.babyId,
      input.actor.userId,
      input.actor.membershipId,
      input.action,
      input.before,
      input.after,
      input.traceId,
    ],
  );
  if (!result.rows[0]) throw new CareEventNotFoundError();
}

export interface VoidCareEventInput {
  eventId: string;
  actor: CareActorContext;
  updatedAt: Date;
}

export async function voidCareEvent(
  client: pg.PoolClient,
  input: VoidCareEventInput,
): Promise<CareEventRow | null> {
  const result = await client.query<CareEventDbRow>(
    `update care_events
        set status = 'voided', version = version + 1, updated_at = $4
      where id = $1 and family_id = $2 and baby_id = $3 and status = 'active'
      returning ${CARE_EVENT_COLUMNS}`,
    [input.eventId, input.actor.familyId, input.actor.babyId, input.updatedAt],
  );
  return result.rows[0] ? toCareEventRow(result.rows[0]) : null;
}
