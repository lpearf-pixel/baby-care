import { describe, expect, it } from 'vitest';
import {
  VoiceCareIntentV2Schema,
  parseCanonicalVoiceCareIntentV2,
  voiceCareProposalDigestV2,
} from '../src/index.js';

const ids = {
  requestId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  leaseId: '33333333-3333-4333-8333-333333333333',
  sessionId: '44444444-4444-4444-8444-444444444444',
};

const envelope = {
  schemaVersion: 2 as const,
  requestId: ids.requestId,
  deviceId: ids.deviceId,
  leaseId: ids.leaseId,
  issuedAt: '2026-10-10T08:00:00.000Z',
  occurredAt: '2026-10-10T08:00:00.000Z',
  deliveryMode: 'live' as const,
  speakerState: 'verified' as const,
  source: 'voice' as const,
  modelVersion: 'm6-synthetic',
  signature: `${'A'.repeat(85)}A`,
};

const components = [
  { kind: 'bottle' as const, liquidType: 'expressed_breast_milk' as const, amountMl: 60 },
  { kind: 'bottle' as const, liquidType: 'formula' as const, amountMl: 30 },
];

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

describe('Voice Care v2 multi-component contract', () => {
  it('accepts a mixed feeding end proposal and computes a stable digest', async () => {
    const intent = VoiceCareIntentV2Schema.parse({
      ...envelope,
      intentType: 'feeding_end',
      careSessionId: ids.sessionId,
      payload: {
        expectedVersion: 3,
        finalProposal: {
          schemaVersion: 2,
          startedAt: envelope.issuedAt,
          endedAt: '2026-10-10T08:20:00.000Z',
          components,
        },
      },
    });
    const parsed = parseCanonicalVoiceCareIntentV2(
      new TextEncoder().encode(canonical(intent)),
    );
    expect(parsed.intentType).toBe('feeding_end');
    if (intent.intentType !== 'feeding_end') throw new Error('expected feeding_end');
    await expect(voiceCareProposalDigestV2(intent.payload.finalProposal)).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps direct breastfeeding as duration and rejects ml on that component', () => {
    expect(VoiceCareIntentV2Schema.safeParse({
      ...envelope,
      intentType: 'feeding_end',
      careSessionId: ids.sessionId,
      payload: {
        expectedVersion: 1,
          finalProposal: {
          schemaVersion: 2,
          startedAt: envelope.issuedAt,
          endedAt: '2026-10-10T08:20:00.000Z',
          components: [{ kind: 'direct_breastfeeding', durationMinutes: 20 }],
        },
      },
    }).success).toBe(true);
    expect(VoiceCareIntentV2Schema.safeParse({
      ...envelope,
      intentType: 'feeding_end',
      careSessionId: ids.sessionId,
      payload: {
        expectedVersion: 1,
          finalProposal: {
          schemaVersion: 2,
          startedAt: envelope.issuedAt,
          endedAt: '2026-10-10T08:20:00.000Z',
          components: [{ kind: 'direct_breastfeeding', durationMinutes: 20, amountMl: 20 }],
        },
      },
    }).success).toBe(false);
  });
});
