import type pg from 'pg';

export interface AuditInput {
  familyId: string;
  actorUserId?: string | null;
  actorMembershipId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  source: 'web' | 'api' | 'system';
  traceId: string;
  metadata?: Record<string, string | number | boolean | null> | null;
  occurredAt?: Date;
}

export async function writeAudit(client: pg.PoolClient, input: AuditInput): Promise<void> {
  await client.query(
    `insert into audit_events (
      family_id,
      actor_user_id,
      actor_membership_id,
      action,
      target_type,
      target_id,
      source,
      trace_id,
      metadata_json,
      occurred_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.familyId,
      input.actorUserId ?? null,
      input.actorMembershipId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.source,
      input.traceId,
      input.metadata ?? null,
      input.occurredAt ?? new Date(),
    ],
  );
}
