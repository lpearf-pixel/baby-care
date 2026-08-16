import type pg from 'pg';
import type {
  CareHandoffCheckpointDto,
  CareSource,
  HandoffReminderRuleInput,
} from '@baby-care/contracts';
import { CareHandoffCheckpointDtoSchema } from '@baby-care/contracts';
import { maskToWeekdays, weekdaysToMask } from '@baby-care/domain';
import type { CareActorContext } from './care-auth.js';

type QueryExecutor = pg.Pool | pg.PoolClient;

export interface HandoffCheckpointRow extends pg.QueryResultRow {
  id: string;
  family_id: string;
  baby_id: string;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  source: CareSource;
  occurred_at: Date;
  created_at: Date;
  client_request_id: string | null;
  trace_id: string;
  actor_display_name: string | null;
}

interface ReminderRuleRow extends pg.QueryResultRow {
  local_time: string;
  weekday_mask: number;
  enabled: boolean;
}

const CHECKPOINT_SELECT = `select hc.id, hc.family_id, hc.baby_id,
       hc.actor_user_id, hc.actor_membership_id, hc.source,
       hc.occurred_at, hc.created_at, hc.client_request_id, hc.trace_id,
       u.display_name as actor_display_name
  from care_handoff_checkpoints hc
  left join users u on u.id = hc.actor_user_id`;

export function checkpointDto(row: HandoffCheckpointRow): CareHandoffCheckpointDto {
  return CareHandoffCheckpointDtoSchema.parse({
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    source: row.source,
  });
}

export async function findHandoffByClientRequestId(
  executor: QueryExecutor,
  actor: CareActorContext,
  clientRequestId: string,
): Promise<HandoffCheckpointRow | null> {
  const result = await executor.query<HandoffCheckpointRow>(
    `${CHECKPOINT_SELECT}
      where hc.family_id = $1 and hc.baby_id = $2
        and hc.actor_user_id = $3 and hc.actor_membership_id = $4
        and hc.client_request_id = $5
      limit 1`,
    [actor.familyId, actor.babyId, actor.userId, actor.membershipId, clientRequestId],
  );
  return result.rows[0] ?? null;
}

export async function insertHandoffCheckpoint(
  client: pg.PoolClient,
  input: {
    actor: CareActorContext;
    occurredAt: Date;
    createdAt: Date;
    clientRequestId: string;
    traceId: string;
  },
): Promise<HandoffCheckpointRow | null> {
  const inserted = await client.query<{ id: string }>(
    `insert into care_handoff_checkpoints (
       family_id, baby_id, actor_user_id, actor_membership_id,
       source, occurred_at, created_at, client_request_id, trace_id
     ) values ($1,$2,$3,$4,'manual',$5,$6,$7,$8)
     on conflict do nothing
     returning id`,
    [
      input.actor.familyId,
      input.actor.babyId,
      input.actor.userId,
      input.actor.membershipId,
      input.occurredAt,
      input.createdAt,
      input.clientRequestId,
      input.traceId,
    ],
  );
  const id = inserted.rows[0]?.id;
  if (!id) return null;
  const result = await client.query<HandoffCheckpointRow>(
    `${CHECKPOINT_SELECT} where hc.id = $1 and hc.family_id = $2 and hc.baby_id = $3`,
    [id, input.actor.familyId, input.actor.babyId],
  );
  return result.rows[0] ?? null;
}

export async function findHandoffById(
  executor: QueryExecutor,
  actor: CareActorContext,
  handoffId: string,
): Promise<HandoffCheckpointRow | null> {
  const result = await executor.query<HandoffCheckpointRow>(
    `${CHECKPOINT_SELECT}
      where hc.id = $1 and hc.family_id = $2 and hc.baby_id = $3
      limit 1`,
    [handoffId, actor.familyId, actor.babyId],
  );
  return result.rows[0] ?? null;
}

export async function findLatestHandoff(
  executor: QueryExecutor,
  actor: CareActorContext,
): Promise<HandoffCheckpointRow | null> {
  const result = await executor.query<HandoffCheckpointRow>(
    `${CHECKPOINT_SELECT}
      where hc.family_id = $1 and hc.baby_id = $2
      order by hc.occurred_at desc, hc.created_at desc, hc.id desc
      limit 1`,
    [actor.familyId, actor.babyId],
  );
  return result.rows[0] ?? null;
}

export async function findPreviousHandoff(
  executor: QueryExecutor,
  actor: CareActorContext,
  checkpoint: HandoffCheckpointRow,
): Promise<HandoffCheckpointRow | null> {
  const result = await executor.query<HandoffCheckpointRow>(
    `${CHECKPOINT_SELECT}
      where hc.family_id = $1 and hc.baby_id = $2
        and (hc.occurred_at, hc.created_at, hc.id) < ($3, $4, $5)
      order by hc.occurred_at desc, hc.created_at desc, hc.id desc
      limit 1`,
    [actor.familyId, actor.babyId, checkpoint.occurred_at, checkpoint.created_at, checkpoint.id],
  );
  return result.rows[0] ?? null;
}

export async function listHandoffReminderRules(
  executor: QueryExecutor,
  actor: CareActorContext,
): Promise<HandoffReminderRuleInput[]> {
  const result = await executor.query<ReminderRuleRow>(
    `select local_time, weekday_mask, enabled
       from care_handoff_reminder_rules
      where family_id = $1 and baby_id = $2
        and actor_user_id = $3 and actor_membership_id = $4
      order by local_time, id`,
    [actor.familyId, actor.babyId, actor.userId, actor.membershipId],
  );
  return result.rows.map((row) => ({
    localTime: row.local_time,
    weekdays: maskToWeekdays(row.weekday_mask),
    enabled: row.enabled,
  }));
}

export async function replaceHandoffReminderRules(
  client: pg.PoolClient,
  actor: CareActorContext,
  rules: readonly HandoffReminderRuleInput[],
  changedAt: Date,
): Promise<void> {
  await client.query(
    `delete from care_handoff_reminder_rules
      where family_id = $1 and baby_id = $2
        and actor_user_id = $3 and actor_membership_id = $4`,
    [actor.familyId, actor.babyId, actor.userId, actor.membershipId],
  );
  for (const rule of rules) {
    await client.query(
      `insert into care_handoff_reminder_rules (
         family_id, baby_id, actor_user_id, actor_membership_id,
         local_time, weekday_mask, enabled, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [
        actor.familyId,
        actor.babyId,
        actor.userId,
        actor.membershipId,
        rule.localTime,
        weekdaysToMask(rule.weekdays),
        rule.enabled,
        changedAt,
      ],
    );
  }
}

export async function loadFamilyTimeZone(executor: QueryExecutor, actor: CareActorContext): Promise<string> {
  const result = await executor.query<{ timezone: string }>(
    `select timezone from families where id = $1 and status = 'active' limit 1`,
    [actor.familyId],
  );
  const timezone = result.rows[0]?.timezone;
  if (!timezone) throw new Error('Active family timezone was not found.');
  return timezone;
}
