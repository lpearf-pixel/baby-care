import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';

import {
  VoiceCareDeviceDtoSchema,
  type PairVoiceCareDeviceInput,
  type VoiceCareDeviceDto,
  type VoiceCarePairingChallengeDto,
  voiceCarePairingSigningBytesV1,
} from '@baby-care/contracts';
import { writeAudit } from '../audit/audit-repository.js';
import type { CareActorContext } from '../care/care-auth.js';
import type { DatabaseContext } from '../db.js';
import {
  insertPairingChallenge,
  listFamilyDevices,
  toVoiceCareDeviceDto,
} from './device-repository.js';
import {
  VoiceCareForbiddenError,
  VoiceCareNotFoundError,
  VoiceCarePairingInvalidError,
  VoiceCareStateConflictError,
} from './errors.js';

const PAIRING_LIFETIME_MS = 5 * 60_000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

interface ChallengeRow {
  challenge_digest: Buffer;
  expires_at: Date;
  consumed_at: Date | null;
}

interface DeviceRow {
  id: string;
  capability: 'voice_care.intent.submit';
  status: 'active' | 'revoked';
  created_at: Date;
  revoked_at: Date | null;
}

export interface VoiceCareDeviceService {
  createChallenge(actor: CareActorContext, traceId: string): Promise<VoiceCarePairingChallengeDto>;
  pair(actor: CareActorContext, input: PairVoiceCareDeviceInput, traceId: string): Promise<VoiceCareDeviceDto>;
  list(actor: CareActorContext): Promise<VoiceCareDeviceDto[]>;
  revoke(actor: CareActorContext, deviceId: string, traceId: string): Promise<VoiceCareDeviceDto>;
}

function requireFamilyAdmin(actor: CareActorContext): void {
  if (actor.permissionLevel !== 'family_admin') throw new VoiceCareForbiddenError();
}

function challengeDigest(challenge: Buffer): Buffer {
  return createHash('sha256').update(challenge).digest();
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function verifyPairingSignature(input: PairVoiceCareDeviceInput): boolean {
  try {
    const { signature: encodedSignature, ...unsigned } = input;
    const rawPublicKey = Buffer.from(input.publicKey, 'base64url');
    const signature = Buffer.from(encodedSignature, 'base64url');
    if (rawPublicKey.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: 'der',
      type: 'spki',
    });
    return verifySignature(null, voiceCarePairingSigningBytesV1(unsigned), key, signature);
  } catch {
    return false;
  }
}

export function createVoiceCareDeviceService(
  database: DatabaseContext,
  now: () => Date = () => new Date(),
  random: (size: number) => Buffer = randomBytes,
): VoiceCareDeviceService {
  return {
    async createChallenge(actor, traceId) {
      requireFamilyAdmin(actor);
      const rawChallenge = random(32);
      if (rawChallenge.length !== 32) throw new VoiceCarePairingInvalidError();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + PAIRING_LIFETIME_MS);
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const challengeId = await insertPairingChallenge(
          client,
          actor,
          challengeDigest(rawChallenge),
          createdAt,
          expiresAt,
        );
        await writeAudit(client, {
          familyId: actor.familyId,
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId,
          action: 'voice_care.pairing_challenge_created',
          targetType: 'voice_care_pairing_challenge',
          targetId: challengeId,
          source: 'web',
          traceId,
          metadata: null,
          occurredAt: createdAt,
        });
        await client.query('commit');
        return {
          challengeId,
          challenge: rawChallenge.toString('base64url'),
          expiresAt: expiresAt.toISOString(),
        };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async pair(actor, input, traceId) {
      requireFamilyAdmin(actor);
      const suppliedChallenge = Buffer.from(input.challenge, 'base64url');
      const suppliedDigest = challengeDigest(suppliedChallenge);
      const current = now();
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const found = await client.query<ChallengeRow>(
          `select challenge_digest, expires_at, consumed_at
             from voice_care_pairing_challenges
            where id = $1 and family_id = $2
            for update`,
          [input.challengeId, actor.familyId],
        );
        const challenge = found.rows[0];
        if (
          !challenge
          || challenge.consumed_at !== null
          || challenge.expires_at.getTime() <= current.getTime()
          || challenge.challenge_digest.length !== suppliedDigest.length
          || !timingSafeEqual(challenge.challenge_digest, suppliedDigest)
          || !verifyPairingSignature(input)
        ) {
          throw new VoiceCarePairingInvalidError();
        }
        const inserted = await client.query<DeviceRow>(
          `insert into voice_care_devices
            (id, family_id, public_key, capability, status, created_at)
           values ($1,$2,$3,'voice_care.intent.submit','active',$4)
           returning id, capability, status, created_at, revoked_at`,
          [input.deviceId, actor.familyId, Buffer.from(input.publicKey, 'base64url'), current],
        );
        const consumed = await client.query(
          `update voice_care_pairing_challenges
              set consumed_at = $3, consumed_by_device_id = $4
            where id = $1 and family_id = $2 and consumed_at is null`,
          [input.challengeId, actor.familyId, current, input.deviceId],
        );
        if (consumed.rowCount !== 1) throw new VoiceCarePairingInvalidError();
        await writeAudit(client, {
          familyId: actor.familyId,
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId,
          action: 'voice_care.device_paired',
          targetType: 'voice_care_device',
          targetId: input.deviceId,
          source: 'web',
          traceId,
          metadata: { capability: 'voice_care.intent.submit' },
          occurredAt: current,
        });
        await client.query('commit');
        return VoiceCareDeviceDtoSchema.parse(toVoiceCareDeviceDto(inserted.rows[0]!));
      } catch (error) {
        await client.query('rollback');
        if (error instanceof VoiceCarePairingInvalidError) throw error;
        if (postgresCode(error) === '23505') throw new VoiceCareStateConflictError();
        throw error;
      } finally {
        client.release();
      }
    },

    list(actor) {
      requireFamilyAdmin(actor);
      return listFamilyDevices(database.pool, actor.familyId);
    },

    async revoke(actor, deviceId, traceId) {
      requireFamilyAdmin(actor);
      const current = now();
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const found = await client.query<DeviceRow>(
          `select id, capability, status, created_at, revoked_at
             from voice_care_devices
            where id = $1 and family_id = $2
            for update`,
          [deviceId, actor.familyId],
        );
        let device = found.rows[0];
        if (!device) throw new VoiceCareNotFoundError();
        if (device.status === 'active') {
          const updated = await client.query<DeviceRow>(
            `update voice_care_devices
                set status = 'revoked', revoked_at = $3
              where id = $1 and family_id = $2 and status = 'active'
              returning id, capability, status, created_at, revoked_at`,
            [deviceId, actor.familyId, current],
          );
          device = updated.rows[0]!;
          await writeAudit(client, {
            familyId: actor.familyId,
            actorUserId: actor.userId,
            actorMembershipId: actor.membershipId,
            action: 'voice_care.device_revoked',
            targetType: 'voice_care_device',
            targetId: deviceId,
            source: 'web',
            traceId,
            metadata: null,
            occurredAt: current,
          });
        }
        await client.query(
          `update voice_care_leases
              set revoked_at = $3
            where family_id = $1 and device_id = $2 and revoked_at is null`,
          [actor.familyId, deviceId, current],
        );
        await client.query('commit');
        return VoiceCareDeviceDtoSchema.parse(toVoiceCareDeviceDto(device));
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
