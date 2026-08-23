import type pg from 'pg';

import type { VoiceCareDeviceDto } from '@baby-care/contracts';
import type { CareActorContext } from '../care/care-auth.js';

interface DeviceRow {
  id: string;
  capability: 'voice_care.intent.submit';
  status: 'active' | 'revoked';
  created_at: Date;
  revoked_at: Date | null;
}

export interface LockedVoiceCareDevice {
  id: string;
  status: 'active' | 'revoked';
}

export function toVoiceCareDeviceDto(row: DeviceRow): VoiceCareDeviceDto {
  return {
    id: row.id,
    capability: row.capability,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

export async function insertPairingChallenge(
  client: pg.PoolClient,
  actor: CareActorContext,
  digest: Buffer,
  createdAt: Date,
  expiresAt: Date,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into voice_care_pairing_challenges
      (family_id, created_by_user_id, created_by_membership_id,
       challenge_digest, created_at, expires_at)
     values ($1,$2,$3,$4,$5,$6)
     returning id`,
    [actor.familyId, actor.userId, actor.membershipId, digest, createdAt, expiresAt],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('voice_care_pairing_challenge_insert_failed');
  return id;
}

export async function listFamilyDevices(pool: pg.Pool, familyId: string): Promise<VoiceCareDeviceDto[]> {
  const result = await pool.query<DeviceRow>(
    `select id, capability, status, created_at, revoked_at
       from voice_care_devices
      where family_id = $1
      order by created_at, id`,
    [familyId],
  );
  return result.rows.map(toVoiceCareDeviceDto);
}

export async function lockFamilyVoiceCareDevice(
  client: pg.PoolClient,
  familyId: string,
  deviceId: string,
): Promise<LockedVoiceCareDevice | null> {
  const result = await client.query<LockedVoiceCareDevice>(
    `select id, status
       from voice_care_devices
      where family_id = $1 and id = $2
      for update`,
    [familyId, deviceId],
  );
  return result.rows[0] ?? null;
}
