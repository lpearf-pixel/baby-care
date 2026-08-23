import { describe, expect, it } from 'vitest';

import {
  ApiErrorSchema,
  CareSourceSchema,
  PairVoiceCareDeviceInputSchema,
  VoiceCareIntentV1Schema,
  VoiceCarePairingChallengeDtoSchema,
  VoiceCareSemanticResultV1Schema,
  VoiceCareStateDtoSchema,
  parseCanonicalVoiceCareIntentV1,
  voiceCarePairingSigningBytesV1,
  voiceCareProposalDigestV1,
  voiceCareSigningBytesV1,
} from '../src/index.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const ISSUED_AT = '2026-08-23T08:00:00.000Z';
const SIGNATURE = 'A'.repeat(86);
const CHALLENGE = 'A'.repeat(43);

const envelope = {
  schemaVersion: 1,
  requestId: REQUEST_ID,
  deviceId: DEVICE_ID,
  leaseId: LEASE_ID,
  issuedAt: ISSUED_AT,
  occurredAt: ISSUED_AT,
  deliveryMode: 'live',
  speakerState: 'verified',
  source: 'voice',
  modelVersion: 'whisper-small-ct2-v1',
  signature: SIGNATURE,
} as const;

describe('M5 Voice Care contracts', () => {
  it('accepts voice as a distinct server-owned care source', () => {
    expect(CareSourceSchema.safeParse('voice').success).toBe(true);
  });

  it('publishes the strict Voice Care v1 intent schema', async () => {
    const contracts = await import('../src/index.js');
    expect('VoiceCareIntentV1Schema' in contracts).toBe(true);
  });

  it('publishes canonical, pairing and semantic result boundaries', async () => {
    const contracts = await import('../src/index.js');
    for (const name of [
      'parseCanonicalVoiceCareIntentV1',
      'voiceCareSigningBytesV1',
      'voiceCareProposalDigestV1',
      'voiceCarePairingSigningBytesV1',
      'VoiceCareSemanticResultV1Schema',
      'VoiceCarePairingChallengeDtoSchema',
      'PairVoiceCareDeviceInputSchema',
      'VoiceCareStateDtoSchema',
    ]) {
      expect(contracts, `missing export ${name}`).toHaveProperty(name);
    }
  });

  it('accepts all five closed intent payloads and rejects unknown fields', () => {
    const intents = [
      {
        ...envelope,
        intentType: 'feeding_start',
        careSessionId: null,
        payload: { mode: 'bottle', startedAt: ISSUED_AT },
      },
      {
        ...envelope,
        intentType: 'feeding_update',
        careSessionId: SESSION_ID,
        payload: {
          expectedVersion: 1,
          proposal: {
            mode: 'bottle',
            startedAt: ISSUED_AT,
            endedAt: null,
            liquidType: 'formula',
            amountMl: 90,
            bottleCapacityMl: 160,
          },
        },
      },
      {
        ...envelope,
        intentType: 'feeding_end',
        careSessionId: SESSION_ID,
        payload: {
          expectedVersion: 2,
          finalProposal: {
            mode: 'direct_breastfeeding',
            startedAt: ISSUED_AT,
            endedAt: '2026-08-23T08:20:00.000Z',
            durationMinutes: 20,
          },
        },
      },
      {
        ...envelope,
        intentType: 'care_confirm',
        careSessionId: SESSION_ID,
        payload: {
          proposalDigest: 'a'.repeat(64),
          expectedVersion: 3,
          warningDigest: null,
          confirmedWarningCodes: [],
        },
      },
      {
        ...envelope,
        intentType: 'care_cancel',
        careSessionId: SESSION_ID,
        payload: { expectedVersion: 3, reason: 'caregiver_cancelled' },
      },
    ];

    for (const intent of intents) expect(VoiceCareIntentV1Schema.safeParse(intent).success).toBe(true);
    expect(VoiceCareIntentV1Schema.safeParse({ ...intents[0], transcript: 'synthetic words' }).success).toBe(false);
    expect(VoiceCareIntentV1Schema.safeParse({ ...intents[1], actorUserId: REQUEST_ID }).success).toBe(false);
  });

  it('rejects payload/discriminant mismatches and unsafe values', () => {
    const start = {
      ...envelope,
      intentType: 'feeding_start',
      careSessionId: null,
      payload: { mode: 'bottle', startedAt: ISSUED_AT },
    };

    expect(VoiceCareIntentV1Schema.safeParse({ ...start, careSessionId: SESSION_ID }).success).toBe(false);
    expect(VoiceCareIntentV1Schema.safeParse({ ...start, payload: { expectedVersion: 1 } }).success).toBe(false);
    expect(VoiceCareIntentV1Schema.safeParse({ ...start, signature: 'not-base64url' }).success).toBe(false);
    expect(VoiceCareIntentV1Schema.safeParse({ ...start, modelVersion: 'private model path/value' }).success).toBe(false);
    expect(VoiceCareIntentV1Schema.safeParse({ ...start, deliveryMode: 'queued' }).success).toBe(false);
    expect(VoiceCareIntentV1Schema.safeParse({ ...start, speakerState: 'dad' }).success).toBe(false);
  });

  it('rejects noncanonical base64url padding bits for keys and signatures', () => {
    const start = {
      ...envelope,
      intentType: 'feeding_start',
      careSessionId: null,
      payload: { mode: 'bottle', startedAt: ISSUED_AT },
    };
    expect(VoiceCareIntentV1Schema.safeParse({ ...start, signature: `${'A'.repeat(85)}B` }).success).toBe(false);
    expect(PairVoiceCareDeviceInputSchema.safeParse({
      challengeId: REQUEST_ID,
      challenge: `${'A'.repeat(42)}B`,
      deviceId: DEVICE_ID,
      publicKey: CHALLENGE,
      signature: SIGNATURE,
    }).success).toBe(false);
  });

  it('accepts only the exact canonical UTF-8 envelope bytes', () => {
    const canonical = '{"careSessionId":null,"deliveryMode":"live","deviceId":"22222222-2222-4222-8222-222222222222","intentType":"feeding_start","issuedAt":"2026-08-23T08:00:00.000Z","leaseId":"33333333-3333-4333-8333-333333333333","modelVersion":"whisper-small-ct2-v1","occurredAt":"2026-08-23T08:00:00.000Z","payload":{"mode":"bottle","startedAt":"2026-08-23T08:00:00.000Z"},"requestId":"11111111-1111-4111-8111-111111111111","schemaVersion":1,"signature":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","source":"voice","speakerState":"verified"}';
    const signing = '{"careSessionId":null,"deliveryMode":"live","deviceId":"22222222-2222-4222-8222-222222222222","intentType":"feeding_start","issuedAt":"2026-08-23T08:00:00.000Z","leaseId":"33333333-3333-4333-8333-333333333333","modelVersion":"whisper-small-ct2-v1","occurredAt":"2026-08-23T08:00:00.000Z","payload":{"mode":"bottle","startedAt":"2026-08-23T08:00:00.000Z"},"requestId":"11111111-1111-4111-8111-111111111111","schemaVersion":1,"source":"voice","speakerState":"verified"}';
    const bytes = new TextEncoder().encode(canonical);

    const parsed = parseCanonicalVoiceCareIntentV1(bytes);
    expect(parsed.intentType).toBe('feeding_start');
    expect(new TextDecoder().decode(voiceCareSigningBytesV1(parsed))).toBe(signing);
    expect(() => parseCanonicalVoiceCareIntentV1(new TextEncoder().encode(` ${canonical}`))).toThrow('voice_care_contract_invalid');
    expect(() => parseCanonicalVoiceCareIntentV1(new TextEncoder().encode(canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')))).toThrow('voice_care_contract_invalid');
  });

  it('binds pairing fields and hashes canonical proposal bytes deterministically', async () => {
    const pairing = voiceCarePairingSigningBytesV1({
      challengeId: REQUEST_ID,
      challenge: CHALLENGE,
      deviceId: DEVICE_ID,
      publicKey: CHALLENGE,
    });
    expect(new TextDecoder().decode(pairing)).toBe(`{"challenge":"${CHALLENGE}","challengeId":"${REQUEST_ID}","deviceId":"${DEVICE_ID}","publicKey":"${CHALLENGE}","purpose":"baby-care-voice-pair-v1"}`);

    await expect(voiceCareProposalDigestV1({
      mode: 'bottle',
      startedAt: ISSUED_AT,
      endedAt: '2026-08-23T08:20:00.000Z',
      liquidType: 'formula',
      amountMl: 90,
      amountValueOrigin: 'spoken',
      bottleCapacityMl: 160,
    })).resolves.toBe('6e831a740060dec8852ffbde4de6ab043475f3d536eb4f0e6b239057a3124d9d');
  });

  it('keeps pairing, semantic results and browser state closed and typed', () => {
    expect(VoiceCarePairingChallengeDtoSchema.safeParse({
      challengeId: REQUEST_ID,
      challenge: CHALLENGE,
      expiresAt: '2026-08-23T08:05:00.000Z',
    }).success).toBe(true);
    expect(PairVoiceCareDeviceInputSchema.safeParse({
      challengeId: REQUEST_ID,
      challenge: CHALLENGE,
      deviceId: DEVICE_ID,
      publicKey: CHALLENGE,
      signature: SIGNATURE,
    }).success).toBe(true);
    expect(VoiceCareSemanticResultV1Schema.safeParse({
      schemaVersion: 1,
      code: 'accepted_pending',
      careSessionId: SESSION_ID,
      careEventId: null,
      sessionVersion: 1,
      proposalDigest: null,
      warningDigest: null,
      warningCodes: [],
      readback: null,
    }).success).toBe(true);
    expect(VoiceCareStateDtoSchema.safeParse({
      devices: [{
        id: DEVICE_ID,
        capability: 'voice_care.intent.submit',
        status: 'active',
        createdAt: ISSUED_AT,
        revokedAt: null,
      }],
      activeLeases: [],
      sessions: [],
    }).success).toBe(true);
    expect(VoiceCareStateDtoSchema.safeParse({ devices: [], activeLeases: [], sessions: [], publicKey: CHALLENGE }).success).toBe(false);
  });

  it('rejects contradictory device status and semantic success results', () => {
    expect(VoiceCareStateDtoSchema.safeParse({
      devices: [{
        id: DEVICE_ID,
        capability: 'voice_care.intent.submit',
        status: 'active',
        createdAt: ISSUED_AT,
        revokedAt: '2026-08-23T08:01:00.000Z',
      }],
      activeLeases: [],
      sessions: [],
    }).success).toBe(false);

    expect(VoiceCareSemanticResultV1Schema.safeParse({
      schemaVersion: 1,
      code: 'accepted_pending',
      careSessionId: SESSION_ID,
      careEventId: REQUEST_ID,
      sessionVersion: 1,
      proposalDigest: null,
      warningDigest: null,
      warningCodes: [],
      readback: null,
    }).success).toBe(false);
    expect(VoiceCareSemanticResultV1Schema.safeParse({
      schemaVersion: 1,
      code: 'saved',
      careSessionId: SESSION_ID,
      careEventId: REQUEST_ID,
      sessionVersion: null,
      proposalDigest: null,
      warningDigest: null,
      warningCodes: [],
      readback: null,
    }).success).toBe(false);
  });

  it('publishes only the closed browser-side Voice Care error codes', () => {
    for (const code of [
      'voice_care_disabled',
      'voice_care_pairing_invalid',
      'voice_care_not_found',
      'voice_care_state_conflict',
    ]) {
      expect(ApiErrorSchema.safeParse({ code, message: 'Voice Care request failed.', traceId: REQUEST_ID }).success).toBe(true);
    }
    expect(ApiErrorSchema.safeParse({ code: 'voice_care_raw_error', message: 'private details', traceId: REQUEST_ID }).success).toBe(false);
  });
});
