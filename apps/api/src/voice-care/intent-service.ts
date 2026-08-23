import {
  VoiceCareSemanticResultV1Schema,
  type VoiceCareSemanticResultV1,
} from '@baby-care/contracts';
import type { DatabaseContext } from '../db.js';
import {
  VoiceCareAuthenticationError,
  type VoiceCareIntentAuthenticator,
} from './intent-authenticator.js';
import { VoiceCareBusyError, VoiceCareIntentCoordinator } from './intent-coordinator.js';
import { applyPendingVoiceIntent } from './session-service.js';

function closedResult(code: VoiceCareSemanticResultV1['code']): VoiceCareSemanticResultV1 {
  return VoiceCareSemanticResultV1Schema.parse({
    schemaVersion: 1,
    code,
    careSessionId: null,
    careEventId: null,
    sessionVersion: null,
    proposalDigest: null,
    warningDigest: null,
    warningCodes: [],
    readback: null,
  });
}

function sameDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

export interface VoiceCareIntentService {
  accept(raw: Uint8Array, acceptedAt: Date, traceId: string, signal: AbortSignal): Promise<VoiceCareSemanticResultV1>;
}

export function createVoiceCareIntentService(
  database: DatabaseContext,
  authenticator: VoiceCareIntentAuthenticator,
  coordinator = new VoiceCareIntentCoordinator(),
): VoiceCareIntentService {
  return {
    async accept(raw, acceptedAt, traceId, signal) {
      let authenticated;
      try {
        authenticated = await authenticator.authenticate(raw, acceptedAt);
      } catch (error) {
        if (error instanceof VoiceCareAuthenticationError) return closedResult('rejected');
        throw error;
      }
      try {
        return await coordinator.run(authenticated.device.id, acceptedAt, signal, async () => {
          const client = await database.pool.connect();
          try {
            await client.query('begin');
            await client.query(`set local statement_timeout = '30000ms'`);
            const authority = await client.query(
              `select l.id
                 from voice_care_leases l
                 join voice_care_devices d
                   on d.family_id = l.family_id and d.id = l.device_id
                 join family_memberships fm
                   on fm.family_id = l.family_id and fm.id = l.actor_membership_id
                  and fm.user_id = l.actor_user_id
                 join users u on u.id = l.actor_user_id
                where l.id = $1 and l.family_id = $2 and l.device_id = $3
                  and l.actor_user_id = $4 and l.actor_membership_id = $5
                  and l.revoked_at is null and l.expires_at > $6
                  and d.status = 'active' and d.capability = 'voice_care.intent.submit'
                  and fm.status = 'active' and u.status = 'active'
                for update of l, d, fm, u`,
              [
                authenticated.lease.id,
                authenticated.device.familyId,
                authenticated.device.id,
                authenticated.actor.userId,
                authenticated.actor.membershipId,
                acceptedAt,
              ],
            );
            if (authority.rowCount !== 1) {
              await client.query('rollback');
              return closedResult('rejected');
            }
            if (signal.aborted) throw new VoiceCareBusyError();
            const receipt = await client.query<{
              request_digest: Buffer;
              result_json: Record<string, unknown>;
            }>(
              `select request_digest, result_json from voice_care_intent_receipts
                where device_id = $1 and request_id = $2 for update`,
              [authenticated.device.id, authenticated.intent.requestId],
            );
            const existing = receipt.rows[0];
            if (existing) {
              await client.query('commit');
              return sameDigest(existing.request_digest, authenticated.requestDigest)
                ? VoiceCareSemanticResultV1Schema.parse(existing.result_json)
                : closedResult('rejected');
            }
            const semantic = await applyPendingVoiceIntent(client, authenticated, acceptedAt, traceId);
            if (signal.aborted) throw new VoiceCareBusyError();
            await client.query(
              `insert into voice_care_intent_receipts
                (family_id, device_id, request_id, request_digest, result_json, received_at)
               values ($1,$2,$3,$4,$5,$6)`,
              [
                authenticated.device.familyId,
                authenticated.device.id,
                authenticated.intent.requestId,
                authenticated.requestDigest,
                semantic,
                acceptedAt,
              ],
            );
            if (signal.aborted) throw new VoiceCareBusyError();
            await client.query('commit');
            return semantic;
          } catch (error) {
            await client.query('rollback');
            throw error;
          } finally {
            client.release();
          }
        });
      } catch (error) {
        if (error instanceof VoiceCareBusyError) return closedResult('temporarily_unavailable');
        return closedResult('temporarily_unavailable');
      }
    },
  };
}
