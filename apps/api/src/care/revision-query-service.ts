import { z } from 'zod';
import { EditCareEventInputSchema, type EditCareEventInput } from '@baby-care/contracts';
import type { DatabaseContext } from '../db.js';
import type { CareActorContext } from './care-auth.js';

export type CareRevisionHistoryItemDto = {
  id: string;
  eventId: string;
  action: 'edit' | 'void';
  actorUserId: string;
  actorDisplayName: string;
  createdAt: string;
  fromVersion: number;
  toVersion: number;
  before: EditCareEventInput | { status: 'active' };
  after: EditCareEventInput | { status: 'voided' };
};

interface CareRevisionHistoryRow {
  id: string;
  event_id: string;
  revision_action: 'edit' | 'void';
  edit_actor_user_id: string;
  actor_display_name: string;
  created_at: Date;
  from_version: number;
  event_type: EditCareEventInput['eventType'];
  event_note: string | null;
  before_json: unknown;
  after_json: unknown;
}

const ActiveSnapshotSchema = z.object({ status: z.literal('active') }).strict();
const VoidedSnapshotSchema = z.object({ status: z.literal('voided') }).strict();
const LegacySleepSnapshotSchema = z.object({
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

function editSnapshot(
  value: unknown,
  eventType: EditCareEventInput['eventType'],
  note: string | null,
): EditCareEventInput {
  const typed = EditCareEventInputSchema.safeParse(value);
  if (typed.success) return typed.data;
  if (eventType === 'sleep') {
    const sleep = LegacySleepSnapshotSchema.parse(value);
    return EditCareEventInputSchema.parse({
      eventType: 'sleep',
      ...sleep,
      ...(note === null ? {} : { note }),
    });
  }
  return EditCareEventInputSchema.parse(value);
}

function beforeSnapshot(row: CareRevisionHistoryRow): CareRevisionHistoryItemDto['before'] {
  const value = row.before_json;
  const active = ActiveSnapshotSchema.safeParse(value);
  return active.success ? active.data : editSnapshot(value, row.event_type, row.event_note);
}

function afterSnapshot(row: CareRevisionHistoryRow): CareRevisionHistoryItemDto['after'] {
  return row.revision_action === 'void'
    ? VoidedSnapshotSchema.parse(row.after_json)
    : editSnapshot(row.after_json, row.event_type, row.event_note);
}

export function createRevisionQueryService(database: DatabaseContext) {
  return {
    async list(actor: CareActorContext, eventId: string): Promise<CareRevisionHistoryItemDto[]> {
      const result = await database.pool.query<CareRevisionHistoryRow>(
        `select cr.id, cr.event_id, cr.revision_action, cr.edit_actor_user_id,
                u.display_name as actor_display_name, cr.created_at,
                row_number() over (order by cr.created_at, cr.id)::int as from_version,
                ce.event_type, ce.note as event_note,
                cr.before_json, cr.after_json
           from care_event_revisions cr
           join care_events ce on ce.id = cr.event_id
           join users u on u.id = cr.edit_actor_user_id
          where cr.event_id = $1 and ce.family_id = $2 and ce.baby_id = $3
          order by cr.created_at, cr.id`,
        [eventId, actor.familyId, actor.babyId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        action: row.revision_action,
        actorUserId: row.edit_actor_user_id,
        actorDisplayName: row.actor_display_name,
        createdAt: row.created_at.toISOString(),
        fromVersion: row.from_version,
        toVersion: row.from_version + 1,
        before: beforeSnapshot(row),
        after: afterSnapshot(row),
      }));
    },
  };
}

export type RevisionQueryService = ReturnType<typeof createRevisionQueryService>;
