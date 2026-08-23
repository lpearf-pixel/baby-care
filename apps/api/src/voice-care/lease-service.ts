import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import type { ActivateVoiceCareLeaseInput, VoiceCareLeaseDto } from '@baby-care/contracts';
import { validateOccurredAt } from '@baby-care/domain';
import { writeAudit } from '../audit/audit-repository.js';
import type { CareActorContext } from '../care/care-auth.js';
import { CareValidationError } from '../care/care-errors.js';
import { insertHandoffCheckpointInTransaction } from '../care/handoff-repository.js';
import type { DatabaseContext } from '../db.js';
import { lockFamilyVoiceCareDevice } from './device-repository.js';
import {
  findLeaseByClientRequestId,
  voiceCareLeaseDto,
  type VoiceCareLeaseRow,
} from './lease-repository.js';
import {
  VoiceCareForbiddenError,
  VoiceCareNotFoundError,
  VoiceCareStateConflictError,
} from './errors.js';

const LEASE_LIFETIME_MS = 8 * 60 * 60_000;

interface LockedActorRow extends pg.QueryResultRow {
  display_name: string;
  relationship: CareActorContext['relationship'];
  permission_level: CareActorContext['permissionLevel'];
  membership_status: 'active' | 'disabled';
  user_status: 'active' | 'disabled';
  baby_status: 'active';
}

export interface VoiceCareLeaseService {
  activate(
    actor: CareActorContext,
    deviceId: string,
    input: ActivateVoiceCareLeaseInput,
    traceId: string,
  ): Promise<VoiceCareLeaseDto>;
  revoke(actor: CareActorContext, leaseId: string, traceId: string): Promise<void>;
}

async function lockActor(client: pg.PoolClient, actor: CareActorContext): Promise<LockedActorRow> {
  const result = await client.query<LockedActorRow>(
    `select u.display_name, fm.relationship, fm.permission_level,
            fm.status membership_status, u.status user_status, b.status baby_status
       from family_memberships fm
       join users u on u.id = fm.user_id
       join babies b on b.family_id = fm.family_id and b.id = $4
      where fm.family_id = $1 and fm.id = $2 and fm.user_id = $3
      for update of fm, u, b`,
    [actor.familyId, actor.membershipId, actor.userId, actor.babyId],
  );
  const row = result.rows[0];
  if (
    !row
    || row.membership_status !== 'active'
    || row.user_status !== 'active'
    || row.baby_status !== 'active'
    || (row.permission_level !== 'family_admin' && row.permission_level !== 'caregiver')
  ) {
    throw new VoiceCareForbiddenError();
  }
  return row;
}

export function createVoiceCareLeaseService(
  database: DatabaseContext,
  now: () => Date = () => new Date(),
): VoiceCareLeaseService {
  return {
    async activate(actor, deviceId, input, traceId) {
      const current = now();
      const occurredAt = new Date(input.occurredAt);
      if (!validateOccurredAt(occurredAt, current).ok) {
        throw new CareValidationError('The Voice Care handoff time is too far in the future.');
      }
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const device = await lockFamilyVoiceCareDevice(client, actor.familyId, deviceId);
        if (!device || device.status !== 'active') throw new VoiceCareNotFoundError();
        const currentActor = await lockActor(client, actor);
        const existing = await findLeaseByClientRequestId(client, actor, input.clientRequestId);
        if (existing) {
          if (existing.device_id !== deviceId) throw new VoiceCareStateConflictError();
          await client.query('commit');
          return voiceCareLeaseDto(existing);
        }

        await client.query(
          `update voice_care_leases
              set revoked_at = $3
            where family_id = $1 and device_id = $2 and revoked_at is null`,
          [actor.familyId, deviceId, current],
        );
        const checkpoint = await insertHandoffCheckpointInTransaction(client, {
          actor,
          source: 'voice',
          occurredAt,
          createdAt: current,
          clientRequestId: input.clientRequestId,
          traceId,
        });
        if (!checkpoint) throw new VoiceCareStateConflictError();
        const leaseId = randomUUID();
        const expiresAt = new Date(current.getTime() + LEASE_LIFETIME_MS);
        const inserted = await client.query<VoiceCareLeaseRow>(
          `insert into voice_care_leases (
             id, family_id, baby_id, device_id, actor_user_id, actor_membership_id,
             client_request_id, issued_at, expires_at, created_at
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8)
           returning id, family_id, baby_id, device_id, actor_user_id,
                     actor_membership_id, $10::text actor_display_name,
                     issued_at, expires_at, revoked_at`,
          [
            leaseId,
            actor.familyId,
            actor.babyId,
            deviceId,
            actor.userId,
            actor.membershipId,
            input.clientRequestId,
            current,
            expiresAt,
            currentActor.display_name,
          ],
        );
        const lease = inserted.rows[0];
        if (!lease) throw new VoiceCareStateConflictError();
        await writeAudit(client, {
          familyId: actor.familyId,
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId,
          action: 'care.handoff_created',
          targetType: 'care_handoff_checkpoint',
          targetId: checkpoint.id,
          source: 'api',
          traceId,
          metadata: { checkpointId: checkpoint.id, source: checkpoint.source, traceId },
          occurredAt: current,
        });
        await writeAudit(client, {
          familyId: actor.familyId,
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId,
          action: 'voice_care.lease_activated',
          targetType: 'voice_care_lease',
          targetId: leaseId,
          source: 'web',
          traceId,
          metadata: { deviceId, checkpointId: checkpoint.id },
          occurredAt: current,
        });
        await client.query('commit');
        return voiceCareLeaseDto(lease);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async revoke(actor, leaseId, traceId) {
      const current = now();
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const currentActor = await lockActor(client, actor);
        const found = await client.query<VoiceCareLeaseRow>(
          `select l.id, l.family_id, l.baby_id, l.device_id, l.actor_user_id,
                  l.actor_membership_id, u.display_name actor_display_name,
                  l.issued_at, l.expires_at, l.revoked_at
             from voice_care_leases l
             join users u on u.id = l.actor_user_id
            where l.id = $1 and l.family_id = $2
            for update of l`,
          [leaseId, actor.familyId],
        );
        const lease = found.rows[0];
        if (!lease) throw new VoiceCareNotFoundError();
        if (currentActor.permission_level !== 'family_admin' && lease.actor_user_id !== actor.userId) {
          throw new VoiceCareForbiddenError();
        }
        if (lease.revoked_at === null) {
          await client.query(
            `update voice_care_leases set revoked_at = $3 where id = $1 and family_id = $2`,
            [leaseId, actor.familyId, current],
          );
          await writeAudit(client, {
            familyId: actor.familyId,
            actorUserId: actor.userId,
            actorMembershipId: actor.membershipId,
            action: 'voice_care.lease_revoked',
            targetType: 'voice_care_lease',
            targetId: leaseId,
            source: 'web',
            traceId,
            metadata: null,
            occurredAt: current,
          });
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
