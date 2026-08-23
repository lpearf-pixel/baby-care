import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

import {
  parseCanonicalVoiceCareIntentV1,
  voiceCareSigningBytesV1,
  type VoiceCareIntentV1,
} from '@baby-care/contracts';
import type { CareActorContext } from '../care/care-auth.js';
import type { DatabaseContext } from '../db.js';
import { findActiveVoiceCareLease } from './lease-repository.js';

const LIVE_WINDOW_MS = 2 * 60_000;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export class VoiceCareAuthenticationError extends Error {
  constructor() {
    super('voice_care_rejected');
    this.name = 'VoiceCareAuthenticationError';
  }
}

export interface AuthenticatedVoiceIntent {
  intent: VoiceCareIntentV1;
  requestDigest: Buffer;
  device: { id: string; familyId: string };
  actor: CareActorContext;
  lease: { id: string; expiresAt: Date };
}

export interface VoiceCareIntentAuthenticator {
  authenticate(raw: Uint8Array, acceptedAt: Date): Promise<AuthenticatedVoiceIntent>;
}

export function createVoiceCareIntentAuthenticator(database: DatabaseContext): VoiceCareIntentAuthenticator {
  return {
    async authenticate(raw, acceptedAt) {
      const intent = parseCanonicalVoiceCareIntentV1(raw);
      const issuedAt = new Date(intent.issuedAt);
      if (
        intent.deliveryMode === 'live'
        && Math.abs(acceptedAt.getTime() - issuedAt.getTime()) > LIVE_WINDOW_MS
      ) {
        throw new VoiceCareAuthenticationError();
      }
      const deviceResult = await database.pool.query<{
        id: string;
        family_id: string;
        public_key: Buffer;
        capability: string;
        status: string;
      }>(
        `select id, family_id, public_key, capability, status
           from voice_care_devices where id = $1 limit 1`,
        [intent.deviceId],
      );
      const device = deviceResult.rows[0];
      if (
        !device
        || device.status !== 'active'
        || device.capability !== 'voice_care.intent.submit'
        || device.public_key.length !== 32
      ) {
        throw new VoiceCareAuthenticationError();
      }
      try {
        const key = createPublicKey({
          key: Buffer.concat([ED25519_SPKI_PREFIX, device.public_key]),
          format: 'der',
          type: 'spki',
        });
        const signature = Buffer.from(intent.signature, 'base64url');
        if (!verifySignature(null, voiceCareSigningBytesV1(intent), key, signature)) {
          throw new VoiceCareAuthenticationError();
        }
      } catch (error) {
        if (error instanceof VoiceCareAuthenticationError) throw error;
        throw new VoiceCareAuthenticationError();
      }
      const active = await findActiveVoiceCareLease(
        database.pool,
        device.family_id,
        device.id,
        acceptedAt,
      );
      if (!active || active.lease.id !== intent.leaseId) throw new VoiceCareAuthenticationError();
      return {
        intent,
        requestDigest: createHash('sha256').update(raw).digest(),
        device: { id: device.id, familyId: device.family_id },
        actor: active.actor,
        lease: { id: active.lease.id, expiresAt: new Date(active.lease.expiresAt) },
      };
    },
  };
}
