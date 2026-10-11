import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';

import {
  type CreateFeedingSessionInput,
  type CareWarning,
  VoiceCareFinalFeedingProposalV2Schema,
  VoiceCareFeedingProposalV2Schema,
  VoiceCareSemanticResultV2Schema,
  type VoiceCareIntentV2,
  type VoiceCareSemanticResultV2,
  voiceCareProposalDigestV2,
} from '@baby-care/contracts';
import { collectFeedingWarnings } from '../care/feeding-warnings.js';
import { writeFeedingSessionInTransaction } from '../care/feeding-write-service.js';
import { writeAudit } from '../audit/audit-repository.js';
import type { AuthenticatedVoiceIntent } from './intent-authenticator.js';
import { lockVoiceCareSession, sweepExpiredVoiceCareSessions } from './session-repository.js';

function result(
  code: VoiceCareSemanticResultV2['code'],
  options: Partial<VoiceCareSemanticResultV2> = {},
): VoiceCareSemanticResultV2 {
  return VoiceCareSemanticResultV2Schema.parse({
    schemaVersion: 2,
    code,
    careSessionId: null,
    careEventId: null,
    sessionVersion: null,
    proposalDigest: null,
    warningDigest: null,
    warningCodes: [],
    readback: null,
    ...options,
  });
}

function warningCodes(warnings: CareWarning[]): CareWarning['code'][] {
  return [...new Set(warnings.map((warning) => warning.code))].sort();
}

function warningSetDigest(codes: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(codes)).digest('hex');
}

function sameCodes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function committedConfirmationMatches(
  session: { final_care_event_id: string | null; proposal_digest: Buffer | null; warning_digest: Buffer | null; warning_codes_json: unknown; version: number },
  confirmation: Extract<VoiceCareIntentV2, { intentType: 'care_confirm' }>['payload'],
): boolean {
  const storedCodes = Array.isArray(session.warning_codes_json)
    ? session.warning_codes_json.filter((value): value is string => typeof value === 'string').sort()
    : [];
  const confirmedCodes = [...confirmation.confirmedWarningCodes].sort();
  return session.final_care_event_id !== null
    && session.proposal_digest?.toString('hex') === confirmation.proposalDigest
    && (session.warning_digest?.toString('hex') ?? null) === confirmation.warningDigest
    && sameCodes(storedCodes, confirmedCodes)
    && session.version === confirmation.expectedVersion + 1;
}

export function feedingInputV2(
  proposal: unknown,
  clientRequestId: string,
): CreateFeedingSessionInput {
  const parsed = VoiceCareFinalFeedingProposalV2Schema.parse(proposal);
  return {
    occurredAt: parsed.endedAt,
    clientRequestId,
    components: parsed.components.map((component) => component.kind === 'bottle'
      ? {
          kind: 'bottle' as const,
          liquidType: component.liquidType,
          amountMl: component.amountMl,
          ...(component.bottleCapacityMl === undefined ? {} : { bottleCapacityMl: component.bottleCapacityMl }),
        }
      : { kind: 'direct_breastfeeding' as const, durationMinutes: component.durationMinutes }),
  };
}

function readback(proposal: ReturnType<typeof VoiceCareFinalFeedingProposalV2Schema.parse>): VoiceCareSemanticResultV2['readback'] {
  return { templateId: 'feeding_components_readback', components: proposal.components };
}

function isReviewOnly(authenticated: AuthenticatedVoiceIntent): boolean {
  return authenticated.intent.deliveryMode === 'replay' || authenticated.intent.speakerState !== 'verified';
}

async function digest(proposal: unknown): Promise<string> {
  return voiceCareProposalDigestV2(VoiceCareFinalFeedingProposalV2Schema.parse(proposal));
}

export async function applyPendingVoiceIntentV2(
  client: pg.PoolClient,
  authenticated: AuthenticatedVoiceIntent,
  acceptedAt: Date,
  traceId: string,
): Promise<VoiceCareSemanticResultV2> {
  const intent = authenticated.intent as VoiceCareIntentV2;
  const { actor, device, lease } = authenticated;
  await sweepExpiredVoiceCareSessions(client, device.familyId, acceptedAt);
  if (intent.speakerState === 'mismatch') return result('identity_mismatch');

  if (intent.intentType === 'feeding_start') {
    const proposal = VoiceCareFeedingProposalV2Schema.parse({
      schemaVersion: 2,
      startedAt: intent.payload.startedAt,
      endedAt: null,
      components: [],
    });
    const state = isReviewOnly(authenticated) ? 'needs_review' : 'pending';
    const sessionId = randomUUID();
    await client.query(
      `insert into voice_care_feeding_sessions
       (id, family_id, baby_id, device_id, lease_id, actor_user_id, actor_membership_id,
        start_request_id, source, state, proposal_json, version, started_at, expires_at, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'voice',$9,$10,1,$11,$12,$13,$13)`,
      [sessionId, device.familyId, actor.babyId, device.id, lease.id, actor.userId,
       actor.membershipId, intent.requestId, state, proposal, new Date(intent.payload.startedAt),
       new Date(new Date(intent.payload.startedAt).getTime() + 6 * 60 * 60_000), acceptedAt],
    );
    return result(state === 'needs_review' ? 'needs_confirmation' : 'accepted_pending', {
      careSessionId: sessionId,
      sessionVersion: 1,
    });
  }

  const session = intent.careSessionId
    ? await lockVoiceCareSession(client, intent.careSessionId, device.familyId, device.id, actor.userId)
    : null;
  if (!session || session.lease_id !== lease.id) return result('state_conflict');

  if (intent.intentType === 'care_confirm' && session.state === 'committed') {
    if (!committedConfirmationMatches(session, intent.payload)) {
      return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
    }
    return result('saved', {
      careSessionId: session.id,
      careEventId: session.final_care_event_id,
      sessionVersion: session.version,
      proposalDigest: session.proposal_digest?.toString('hex') ?? null,
      warningDigest: session.warning_digest?.toString('hex') ?? null,
      warningCodes: session.warning_codes_json as CareWarning['code'][] ,
      readback: readback(VoiceCareFinalFeedingProposalV2Schema.parse(session.proposal_json)),
    });
  }

  const expectedVersion = intent.payload.expectedVersion;
  if (session.version !== expectedVersion || ['cancelled', 'committing', 'committed'].includes(session.state)) {
    return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
  }

  if (intent.intentType === 'care_cancel') {
    const version = session.version + 1;
    await client.query(
      `update voice_care_feeding_sessions set state = 'cancelled', cancelled_at = $2, updated_at = $2, version = $3 where id = $1`,
      [session.id, acceptedAt, version],
    );
    return result('accepted_pending', { careSessionId: session.id, sessionVersion: version });
  }

  if (intent.intentType === 'care_confirm') {
    const storedDigest = session.proposal_digest?.toString('hex') ?? null;
    if (!storedDigest || storedDigest !== intent.payload.proposalDigest) {
      return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
    }
    if (session.state === 'needs_review' || isReviewOnly(authenticated)) {
      return result('needs_confirmation', { careSessionId: session.id, sessionVersion: session.version, proposalDigest: storedDigest });
    }
    const proposal = VoiceCareFinalFeedingProposalV2Schema.parse(session.proposal_json);
    const input = feedingInputV2(proposal, intent.requestId);
    const warnings = await collectFeedingWarnings(client, actor, input, acceptedAt);
    const codes = warningCodes(warnings);
    const warningDigest = codes.length === 0 ? null : warningSetDigest(codes);
    const supplied = [...intent.payload.confirmedWarningCodes].sort();
    if (warningDigest !== intent.payload.warningDigest || !sameCodes(codes, supplied)) {
      if (codes.length === 0) return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
      const version = session.version + 1;
      await client.query(
        `update voice_care_feeding_sessions set state = 'needs_confirmation', warning_digest = $2, warning_codes_json = $3::jsonb, version = $4, updated_at = $5 where id = $1`,
        [session.id, Buffer.from(warningDigest!, 'hex'), JSON.stringify(codes), version, acceptedAt],
      );
      return result('needs_confirmation', {
        careSessionId: session.id, sessionVersion: version, proposalDigest: storedDigest,
        warningDigest, warningCodes: codes, readback: readback(proposal),
      });
    }
    await client.query(`update voice_care_feeding_sessions set state = 'committing', updated_at = $2 where id = $1`, [session.id, acceptedAt]);
    const event = await writeFeedingSessionInTransaction(client, actor, input, traceId, 'voice');
    const version = session.version + 1;
    await client.query(
      `update voice_care_feeding_sessions set state = 'committed', final_care_event_id = $2, confirmed_at = $3, version = $4, updated_at = $3 where id = $1`,
      [session.id, event.id, acceptedAt, version],
    );
    await writeAudit(client, {
      familyId: actor.familyId, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
      action: 'voice_care.session_committed', targetType: 'voice_care_feeding_session', targetId: session.id,
      source: 'api', traceId, metadata: { careEventId: event.id }, occurredAt: acceptedAt,
    });
    return result('saved', {
      careSessionId: session.id, careEventId: event.id, sessionVersion: version,
      proposalDigest: storedDigest, warningDigest, warningCodes: codes, readback: readback(proposal),
    });
  }

  if (intent.intentType === 'feeding_update') {
    const current = VoiceCareFeedingProposalV2Schema.parse(session.proposal_json);
    const proposal = VoiceCareFeedingProposalV2Schema.parse({
      schemaVersion: 2, startedAt: current.startedAt, endedAt: null, components: intent.payload.components,
    });
    const version = session.version + 1;
    const state = session.state === 'needs_review' || isReviewOnly(authenticated) ? 'needs_review' : 'pending';
    await client.query(
      `update voice_care_feeding_sessions set proposal_json = $2, state = $3, version = $4, updated_at = $5 where id = $1`,
      [session.id, proposal, state, version, acceptedAt],
    );
    return result(state === 'needs_review' ? 'needs_confirmation' : 'accepted_pending', { careSessionId: session.id, sessionVersion: version });
  }

  const current = VoiceCareFeedingProposalV2Schema.parse(session.proposal_json);
  const proposal = VoiceCareFinalFeedingProposalV2Schema.parse(intent.payload.finalProposal);
  if (proposal.startedAt !== current.startedAt) return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
  const proposalDigest = await digest(proposal);
  const version = session.version + 1;
  const state = session.state === 'needs_review' || isReviewOnly(authenticated) ? 'needs_review' : 'needs_confirmation';
  await client.query(
    `update voice_care_feeding_sessions set proposal_json = $2, proposal_digest = $3, state = $4, ended_at = $5, version = $6, updated_at = $7 where id = $1`,
    [session.id, proposal, Buffer.from(proposalDigest, 'hex'), state, new Date(proposal.endedAt), version, acceptedAt],
  );
  return result('needs_confirmation', { careSessionId: session.id, sessionVersion: version, proposalDigest, readback: readback(proposal) });
}
