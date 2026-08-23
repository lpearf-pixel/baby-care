import type pg from 'pg';

export interface VoiceCareSessionRow extends pg.QueryResultRow {
  id: string;
  family_id: string;
  baby_id: string;
  device_id: string;
  lease_id: string;
  actor_user_id: string;
  actor_membership_id: string;
  state: 'pending' | 'needs_confirmation' | 'needs_review' | 'cancelled' | 'committing' | 'committed';
  proposal_json: Record<string, unknown>;
  version: number;
  proposal_digest: Buffer | null;
  warning_digest: Buffer | null;
  warning_codes_json: string[];
  final_care_event_id: string | null;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
}

export async function lockVoiceCareSession(
  client: pg.PoolClient,
  sessionId: string,
  familyId: string,
  deviceId: string,
  actorUserId: string,
): Promise<VoiceCareSessionRow | null> {
  const result = await client.query<VoiceCareSessionRow>(
    `select id, family_id, baby_id, device_id, lease_id, actor_user_id,
            actor_membership_id, state, proposal_json, version, proposal_digest,
            warning_digest, warning_codes_json, final_care_event_id, started_at,
            expires_at, ended_at, confirmed_at, cancelled_at
       from voice_care_feeding_sessions
      where id = $1 and family_id = $2 and device_id = $3 and actor_user_id = $4
      for update`,
    [sessionId, familyId, deviceId, actorUserId],
  );
  return result.rows[0] ?? null;
}

export async function sweepExpiredVoiceCareSessions(
  client: pg.PoolClient,
  familyId: string,
  current: Date,
): Promise<void> {
  await client.query(
    `update voice_care_feeding_sessions
        set state = 'needs_review', updated_at = $2, version = version + 1
      where family_id = $1 and expires_at <= $2
        and state in ('pending','needs_confirmation','committing')`,
    [familyId, current],
  );
}
