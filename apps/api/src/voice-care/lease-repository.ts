import type pg from 'pg';

import { VoiceCareLeaseDtoSchema, type VoiceCareLeaseDto } from '@baby-care/contracts';
import type { CareActorContext } from '../care/care-auth.js';

type QueryExecutor = pg.Pool | pg.PoolClient;

export interface VoiceCareLeaseRow extends pg.QueryResultRow {
  id: string;
  family_id: string;
  baby_id: string;
  device_id: string;
  actor_user_id: string;
  actor_membership_id: string;
  actor_display_name: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

export interface ActiveVoiceCareLease {
  lease: VoiceCareLeaseDto;
  actor: CareActorContext;
}

const LEASE_SELECT = `select l.id, l.family_id, l.baby_id, l.device_id,
       l.actor_user_id, l.actor_membership_id, u.display_name actor_display_name,
       l.issued_at, l.expires_at, l.revoked_at`;

export function voiceCareLeaseDto(row: VoiceCareLeaseRow): VoiceCareLeaseDto {
  return VoiceCareLeaseDtoSchema.parse({
    id: row.id,
    deviceId: row.device_id,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  });
}

export async function findLeaseByClientRequestId(
  client: pg.PoolClient,
  actor: CareActorContext,
  clientRequestId: string,
): Promise<VoiceCareLeaseRow | null> {
  const result = await client.query<VoiceCareLeaseRow>(
    `${LEASE_SELECT}
       from voice_care_leases l
       join users u on u.id = l.actor_user_id
      where l.family_id = $1 and l.actor_user_id = $2 and l.client_request_id = $3
      limit 1`,
    [actor.familyId, actor.userId, clientRequestId],
  );
  return result.rows[0] ?? null;
}

export async function findActiveVoiceCareLease(
  executor: QueryExecutor,
  familyId: string,
  deviceId: string,
  current: Date,
): Promise<ActiveVoiceCareLease | null> {
  const result = await executor.query<VoiceCareLeaseRow & {
    relationship: CareActorContext['relationship'];
    permission_level: CareActorContext['permissionLevel'];
  }>(
    `${LEASE_SELECT}, fm.relationship, fm.permission_level
       from voice_care_leases l
       join voice_care_devices d
         on d.family_id = l.family_id and d.id = l.device_id and d.status = 'active'
       join family_memberships fm
         on fm.family_id = l.family_id and fm.id = l.actor_membership_id
        and fm.user_id = l.actor_user_id and fm.status = 'active'
       join users u on u.id = l.actor_user_id and u.status = 'active'
       join babies b on b.family_id = l.family_id and b.id = l.baby_id and b.status = 'active'
      where l.family_id = $1 and l.device_id = $2
        and l.revoked_at is null and l.expires_at > $3
      limit 1`,
    [familyId, deviceId, current],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    lease: voiceCareLeaseDto(row),
    actor: {
      userId: row.actor_user_id,
      membershipId: row.actor_membership_id,
      familyId: row.family_id,
      babyId: row.baby_id,
      relationship: row.relationship,
      permissionLevel: row.permission_level,
    },
  };
}
