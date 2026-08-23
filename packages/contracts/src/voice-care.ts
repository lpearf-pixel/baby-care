import { z } from 'zod';

import { BottleLiquidTypeSchema } from './care/feeding-components.js';
import { CareWarningCodeSchema } from './care/common.js';

const OffsetTimestampSchema = z.string().datetime({ offset: true });
const PositiveSafeIntegerSchema = z.number().int().positive().safe();
const NullablePositiveSafeIntegerSchema = PositiveSafeIntegerSchema.nullable();
const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const Base64Url32BytesSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const Base64Url64BytesSchema = z.string().regex(/^[A-Za-z0-9_-]{85}[AQgw]$/);
const ModelVersionSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);

export const VoiceCareSpeakerStateSchema = z.enum([
  'verified',
  'uncertain',
  'mismatch',
  'not_enrolled',
  'unavailable',
]);

export const VoiceCareDeliveryModeSchema = z.enum(['live', 'replay']);
export const VoiceCareIntentTypeSchema = z.enum([
  'feeding_start',
  'feeding_update',
  'feeding_end',
  'care_confirm',
  'care_cancel',
]);

const VoiceCareUnknownProposalInputV1Schema = z.object({
  mode: z.literal('unknown'),
  startedAt: OffsetTimestampSchema,
  endedAt: z.null(),
}).strict();

const VoiceCareBottleProposalInputV1Schema = z.object({
  mode: z.literal('bottle'),
  startedAt: OffsetTimestampSchema,
  endedAt: OffsetTimestampSchema.nullable(),
  liquidType: BottleLiquidTypeSchema.nullable(),
  amountMl: NullablePositiveSafeIntegerSchema,
  bottleCapacityMl: NullablePositiveSafeIntegerSchema,
}).strict();

const VoiceCareDirectProposalInputV1Schema = z.object({
  mode: z.literal('direct_breastfeeding'),
  startedAt: OffsetTimestampSchema,
  endedAt: OffsetTimestampSchema.nullable(),
  durationMinutes: NullablePositiveSafeIntegerSchema,
}).strict();

export const VoiceCareFeedingProposalInputV1Schema = z.discriminatedUnion('mode', [
  VoiceCareUnknownProposalInputV1Schema,
  VoiceCareBottleProposalInputV1Schema,
  VoiceCareDirectProposalInputV1Schema,
]);

const VoiceCareFinalBottleProposalInputV1Schema = z.object({
  mode: z.literal('bottle'),
  startedAt: OffsetTimestampSchema,
  endedAt: OffsetTimestampSchema,
  liquidType: BottleLiquidTypeSchema,
  amountMl: PositiveSafeIntegerSchema,
  bottleCapacityMl: NullablePositiveSafeIntegerSchema,
}).strict();

const VoiceCareFinalDirectProposalInputV1Schema = z.object({
  mode: z.literal('direct_breastfeeding'),
  startedAt: OffsetTimestampSchema,
  endedAt: OffsetTimestampSchema,
  durationMinutes: PositiveSafeIntegerSchema,
}).strict();

export const VoiceCareFinalFeedingProposalInputV1Schema = z.discriminatedUnion('mode', [
  VoiceCareFinalBottleProposalInputV1Schema,
  VoiceCareFinalDirectProposalInputV1Schema,
]);

const VoiceCareStoredBottleProposalV1Schema = VoiceCareBottleProposalInputV1Schema.extend({
  amountValueOrigin: z.enum(['spoken', 'family_default']).nullable(),
}).strict();

export const VoiceCareFeedingProposalV1Schema = z.discriminatedUnion('mode', [
  VoiceCareUnknownProposalInputV1Schema,
  VoiceCareStoredBottleProposalV1Schema,
  VoiceCareDirectProposalInputV1Schema,
]);

function uniqueWarningCodes(value: string[], context: z.RefinementCtx): void {
  if (new Set(value).size !== value.length) {
    context.addIssue({ code: 'custom', message: 'warning codes must be unique' });
  }
}

export const ConfirmVoiceCareSessionInputSchema = z.object({
  proposalDigest: Sha256HexSchema,
  expectedVersion: PositiveSafeIntegerSchema,
  warningDigest: Sha256HexSchema.nullable(),
  confirmedWarningCodes: z.array(CareWarningCodeSchema).max(4).superRefine(uniqueWarningCodes),
}).strict().superRefine((value, context) => {
  if ((value.warningDigest === null) !== (value.confirmedWarningCodes.length === 0)) {
    context.addIssue({ code: 'custom', message: 'warning digest and codes must be supplied together' });
  }
});

export const CancelVoiceCareSessionInputSchema = z.object({
  expectedVersion: PositiveSafeIntegerSchema,
  reason: z.enum(['caregiver_cancelled', 'duplicate', 'incorrect_intent', 'stale']),
}).strict();

const VoiceCareEnvelopeShape = {
  schemaVersion: z.literal(1),
  requestId: z.string().uuid(),
  deviceId: z.string().uuid(),
  leaseId: z.string().uuid(),
  issuedAt: OffsetTimestampSchema,
  occurredAt: OffsetTimestampSchema,
  deliveryMode: VoiceCareDeliveryModeSchema,
  speakerState: VoiceCareSpeakerStateSchema,
  source: z.literal('voice'),
  modelVersion: ModelVersionSchema,
  signature: Base64Url64BytesSchema,
};

const FeedingStartIntentV1Schema = z.object({
  ...VoiceCareEnvelopeShape,
  intentType: z.literal('feeding_start'),
  careSessionId: z.null(),
  payload: z.object({
    mode: z.enum(['unknown', 'bottle', 'direct_breastfeeding']),
    startedAt: OffsetTimestampSchema,
  }).strict(),
}).strict();

const FeedingUpdateIntentV1Schema = z.object({
  ...VoiceCareEnvelopeShape,
  intentType: z.literal('feeding_update'),
  careSessionId: z.string().uuid(),
  payload: z.object({
    expectedVersion: PositiveSafeIntegerSchema,
    proposal: VoiceCareFeedingProposalInputV1Schema,
  }).strict(),
}).strict();

const FeedingEndIntentV1Schema = z.object({
  ...VoiceCareEnvelopeShape,
  intentType: z.literal('feeding_end'),
  careSessionId: z.string().uuid(),
  payload: z.object({
    expectedVersion: PositiveSafeIntegerSchema,
    finalProposal: VoiceCareFinalFeedingProposalInputV1Schema,
  }).strict(),
}).strict();

const CareConfirmIntentV1Schema = z.object({
  ...VoiceCareEnvelopeShape,
  intentType: z.literal('care_confirm'),
  careSessionId: z.string().uuid(),
  payload: ConfirmVoiceCareSessionInputSchema,
}).strict();

const CareCancelIntentV1Schema = z.object({
  ...VoiceCareEnvelopeShape,
  intentType: z.literal('care_cancel'),
  careSessionId: z.string().uuid(),
  payload: CancelVoiceCareSessionInputSchema,
}).strict();

export const VoiceCareIntentV1Schema = z.discriminatedUnion('intentType', [
  FeedingStartIntentV1Schema,
  FeedingUpdateIntentV1Schema,
  FeedingEndIntentV1Schema,
  CareConfirmIntentV1Schema,
  CareCancelIntentV1Schema,
]);

export type VoiceCareIntentV1 = z.infer<typeof VoiceCareIntentV1Schema>;
export type VoiceCareFeedingProposalInputV1 = z.infer<typeof VoiceCareFeedingProposalInputV1Schema>;
export type VoiceCareFeedingProposalV1 = z.infer<typeof VoiceCareFeedingProposalV1Schema>;
export type ConfirmVoiceCareSessionInput = z.infer<typeof ConfirmVoiceCareSessionInputSchema>;
export type CancelVoiceCareSessionInput = z.infer<typeof CancelVoiceCareSessionInputSchema>;

export const VoiceCarePublicKeySchema = Base64Url32BytesSchema;
export const VoiceCareSignatureSchema = Base64Url64BytesSchema;
export const VoiceCareDigestSchema = Sha256HexSchema;

export const VoiceCarePairingChallengeDtoSchema = z.object({
  challengeId: z.string().uuid(),
  challenge: Base64Url32BytesSchema,
  expiresAt: OffsetTimestampSchema,
}).strict();

export const PairVoiceCareDeviceInputSchema = z.object({
  challengeId: z.string().uuid(),
  challenge: Base64Url32BytesSchema,
  deviceId: z.string().uuid(),
  publicKey: Base64Url32BytesSchema,
  signature: Base64Url64BytesSchema,
}).strict();

const PairVoiceCareDeviceSigningInputSchema = PairVoiceCareDeviceInputSchema.omit({ signature: true });

export const VoiceCareDeviceDtoSchema = z.object({
  id: z.string().uuid(),
  capability: z.literal('voice_care.intent.submit'),
  status: z.enum(['active', 'revoked']),
  createdAt: OffsetTimestampSchema,
  revokedAt: OffsetTimestampSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.status === 'active') !== (value.revokedAt === null)) {
    context.addIssue({ code: 'custom', message: 'device status and revocation timestamp must agree' });
  }
});

export const ActivateVoiceCareLeaseInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  occurredAt: OffsetTimestampSchema,
}).strict();

export const VoiceCareLeaseDtoSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorDisplayName: z.string().min(1).max(120),
  issuedAt: OffsetTimestampSchema,
  expiresAt: OffsetTimestampSchema,
  revokedAt: OffsetTimestampSchema.nullable(),
}).strict();

export const VoiceCareSessionStateSchema = z.enum([
  'pending',
  'needs_confirmation',
  'needs_review',
  'cancelled',
  'committing',
  'committed',
]);

export const VoiceCareSessionDtoSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorDisplayName: z.string().min(1).max(120),
  state: VoiceCareSessionStateSchema,
  proposal: VoiceCareFeedingProposalV1Schema,
  version: PositiveSafeIntegerSchema,
  proposalDigest: Sha256HexSchema.nullable(),
  warningDigest: Sha256HexSchema.nullable(),
  warningCodes: z.array(CareWarningCodeSchema).max(4).superRefine(uniqueWarningCodes),
  finalCareEventId: z.string().uuid().nullable(),
  startedAt: OffsetTimestampSchema,
  expiresAt: OffsetTimestampSchema,
  endedAt: OffsetTimestampSchema.nullable(),
  confirmedAt: OffsetTimestampSchema.nullable(),
  cancelledAt: OffsetTimestampSchema.nullable(),
  canConfirm: z.boolean(),
  canCancel: z.boolean(),
}).strict();

export const VoiceCareStateDtoSchema = z.object({
  devices: z.array(VoiceCareDeviceDtoSchema).max(16),
  activeLeases: z.array(VoiceCareLeaseDtoSchema).max(16),
  sessions: z.array(VoiceCareSessionDtoSchema).max(100),
}).strict();

const VoiceCareReadbackSchema = z.discriminatedUnion('templateId', [
  z.object({
    templateId: z.literal('feeding_bottle_readback'),
    liquidType: BottleLiquidTypeSchema,
    amountMl: PositiveSafeIntegerSchema,
    bottleCapacityMl: NullablePositiveSafeIntegerSchema,
  }).strict(),
  z.object({
    templateId: z.literal('feeding_direct_readback'),
    durationMinutes: PositiveSafeIntegerSchema,
  }).strict(),
]);

export const VoiceCareSemanticCodeSchema = z.enum([
  'accepted_pending',
  'saved',
  'needs_identity',
  'needs_confirmation',
  'identity_mismatch',
  'state_conflict',
  'temporarily_unavailable',
  'rejected',
]);

export const VoiceCareSemanticResultV1Schema = z.object({
  schemaVersion: z.literal(1),
  code: VoiceCareSemanticCodeSchema,
  careSessionId: z.string().uuid().nullable(),
  careEventId: z.string().uuid().nullable(),
  sessionVersion: PositiveSafeIntegerSchema.nullable(),
  proposalDigest: Sha256HexSchema.nullable(),
  warningDigest: Sha256HexSchema.nullable(),
  warningCodes: z.array(CareWarningCodeSchema).max(4).superRefine(uniqueWarningCodes),
  readback: VoiceCareReadbackSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.warningDigest === null) !== (value.warningCodes.length === 0)) {
    context.addIssue({ code: 'custom', message: 'warning digest and codes must be supplied together' });
  }
  if (value.code === 'saved' && (
    value.careSessionId === null
    || value.careEventId === null
    || value.sessionVersion === null
    || value.proposalDigest === null
  )) {
    context.addIssue({ code: 'custom', message: 'saved requires session, care event, version and proposal identifiers' });
  }
  if (value.code === 'accepted_pending' && (
    value.careSessionId === null
    || value.careEventId !== null
    || value.sessionVersion === null
  )) {
    context.addIssue({ code: 'custom', message: 'accepted pending requires a session and version without a care event' });
  }
});

export class VoiceCareContractError extends Error {
  readonly code = 'voice_care_contract_invalid';

  constructor() {
    super('voice_care_contract_invalid');
    this.name = 'VoiceCareContractError';
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new VoiceCareContractError();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new VoiceCareContractError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new VoiceCareContractError();
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson(value));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export function parseCanonicalVoiceCareIntentV1(raw: Uint8Array): VoiceCareIntentV1 {
  if (raw.byteLength === 0 || raw.byteLength > 16_384) throw new VoiceCareContractError();
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    const parsed: unknown = JSON.parse(text);
    const intent = VoiceCareIntentV1Schema.parse(parsed);
    if (!bytesEqual(raw, canonicalBytes(intent))) throw new VoiceCareContractError();
    return intent;
  } catch (error) {
    if (error instanceof VoiceCareContractError) throw error;
    throw new VoiceCareContractError();
  }
}

export function voiceCareSigningBytesV1(intent: VoiceCareIntentV1): Uint8Array {
  const parsed = VoiceCareIntentV1Schema.parse(intent);
  const unsigned = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'signature'));
  return canonicalBytes(unsigned);
}

export async function voiceCareProposalDigestV1(proposal: VoiceCareFeedingProposalV1): Promise<string> {
  const parsed = VoiceCareFeedingProposalV1Schema.parse(proposal);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', canonicalBytes(parsed));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function voiceCarePairingSigningBytesV1(input: z.infer<typeof PairVoiceCareDeviceSigningInputSchema>): Uint8Array {
  const parsed = PairVoiceCareDeviceSigningInputSchema.parse(input);
  return canonicalBytes({ ...parsed, purpose: 'baby-care-voice-pair-v1' });
}

export type VoiceCareSemanticResultV1 = z.infer<typeof VoiceCareSemanticResultV1Schema>;
export type VoiceCarePairingChallengeDto = z.infer<typeof VoiceCarePairingChallengeDtoSchema>;
export type PairVoiceCareDeviceInput = z.infer<typeof PairVoiceCareDeviceInputSchema>;
export type VoiceCareDeviceDto = z.infer<typeof VoiceCareDeviceDtoSchema>;
export type ActivateVoiceCareLeaseInput = z.infer<typeof ActivateVoiceCareLeaseInputSchema>;
export type VoiceCareLeaseDto = z.infer<typeof VoiceCareLeaseDtoSchema>;
export type VoiceCareSessionDto = z.infer<typeof VoiceCareSessionDtoSchema>;
export type VoiceCareStateDto = z.infer<typeof VoiceCareStateDtoSchema>;
