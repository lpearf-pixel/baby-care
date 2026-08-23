import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';

import {
  type CareWarning,
  type CancelVoiceCareSessionInput,
  type ConfirmVoiceCareSessionInput,
  type CreateFeedingSessionInput,
  VoiceCareFeedingProposalV1Schema,
  VoiceCareStateDtoSchema,
  VoiceCareSemanticResultV1Schema,
  voiceCareProposalDigestV1,
  type VoiceCareFeedingProposalV1,
  type VoiceCareSemanticResultV1,
  type VoiceCareStateDto,
} from '@baby-care/contracts';
import type { CareActorContext } from '../care/care-auth.js';
import { writeAudit } from '../audit/audit-repository.js';
import { collectFeedingWarnings } from '../care/feeding-warnings.js';
import { writeFeedingSessionInTransaction } from '../care/feeding-write-service.js';
import type { DatabaseContext } from '../db.js';
import { toVoiceCareDeviceDto } from './device-repository.js';
import type { AuthenticatedVoiceIntent } from './intent-authenticator.js';
import { voiceCareLeaseDto, type VoiceCareLeaseRow } from './lease-repository.js';
import {
  lockVoiceCareSession,
  sweepExpiredVoiceCareSessions,
  type VoiceCareSessionRow,
} from './session-repository.js';

const SESSION_LIFETIME_MS = 6 * 60 * 60_000;

export interface VoiceCareSessionService {
  state(actor: CareActorContext): Promise<VoiceCareStateDto>;
  confirmFromBrowser(
    actor: CareActorContext,
    sessionId: string,
    input: ConfirmVoiceCareSessionInput,
    traceId: string,
  ): Promise<VoiceCareSemanticResultV1>;
  cancelFromBrowser(
    actor: CareActorContext,
    sessionId: string,
    input: CancelVoiceCareSessionInput,
    traceId: string,
  ): Promise<VoiceCareSemanticResultV1>;
}

export function createVoiceCareSessionService(
  database: DatabaseContext,
  now: () => Date = () => new Date(),
): VoiceCareSessionService {
  return {
    async state(actor) {
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const current = now();
        await sweepExpiredVoiceCareSessions(client, actor.familyId, current);
        const devices = await client.query<{
              id: string;
              capability: 'voice_care.intent.submit';
              status: 'active' | 'revoked';
              created_at: Date;
              revoked_at: Date | null;
            }>(
              `select id, capability, status, created_at, revoked_at
                 from voice_care_devices
                where family_id = $1 and ($2::boolean or status = 'active')
                order by created_at, id limit 16`,
              [actor.familyId, actor.permissionLevel === 'family_admin'],
            );
        const leases = await client.query<VoiceCareLeaseRow>(
          `select l.id, l.family_id, l.baby_id, l.device_id, l.actor_user_id,
                  l.actor_membership_id, u.display_name actor_display_name,
                  l.issued_at, l.expires_at, l.revoked_at
             from voice_care_leases l
             join voice_care_devices d
               on d.family_id = l.family_id and d.id = l.device_id and d.status = 'active'
             join family_memberships fm
               on fm.family_id = l.family_id and fm.id = l.actor_membership_id
              and fm.user_id = l.actor_user_id and fm.status = 'active'
             join users u on u.id = l.actor_user_id and u.status = 'active'
            where l.family_id = $1 and l.revoked_at is null and l.expires_at > $2
            order by l.issued_at, l.id limit 16`,
          [actor.familyId, current],
        );
        const sessions = await client.query<VoiceCareSessionRow & { actor_display_name: string }>(
          `select s.id, s.family_id, s.baby_id, s.device_id, s.lease_id,
                  s.actor_user_id, s.actor_membership_id, s.state, s.proposal_json,
                  s.version, s.proposal_digest, s.warning_digest, s.warning_codes_json,
                  s.final_care_event_id, s.started_at, s.expires_at, s.ended_at,
                  s.confirmed_at, s.cancelled_at, u.display_name actor_display_name
             from voice_care_feeding_sessions s join users u on u.id = s.actor_user_id
            where s.family_id = $1 and s.baby_id = $2
              and ($3::boolean or s.actor_user_id = $4)
            order by s.started_at, s.id limit 100`,
          [actor.familyId, actor.babyId, actor.permissionLevel === 'family_admin', actor.userId],
        );
        const state = VoiceCareStateDtoSchema.parse({
          devices: devices.rows.map(toVoiceCareDeviceDto),
          activeLeases: leases.rows.map(voiceCareLeaseDto),
          sessions: sessions.rows.map((row) => ({
            id: row.id,
            deviceId: row.device_id,
            actorUserId: row.actor_user_id,
            actorDisplayName: row.actor_display_name,
            state: row.state,
            proposal: row.proposal_json,
            version: row.version,
            proposalDigest: row.proposal_digest?.toString('hex') ?? null,
            warningDigest: row.warning_digest?.toString('hex') ?? null,
            warningCodes: row.warning_codes_json,
            finalCareEventId: row.final_care_event_id,
            startedAt: row.started_at.toISOString(),
            expiresAt: row.expires_at.toISOString(),
            endedAt: row.ended_at?.toISOString() ?? null,
            confirmedAt: row.confirmed_at?.toISOString() ?? null,
            cancelledAt: row.cancelled_at?.toISOString() ?? null,
            canConfirm: row.actor_user_id === actor.userId
              && (
                row.state === 'needs_confirmation'
                || (row.state === 'needs_review' && row.proposal_digest !== null && row.ended_at !== null)
              ),
            canCancel: ['pending', 'needs_confirmation', 'needs_review'].includes(row.state)
              && (actor.permissionLevel === 'family_admin' || row.actor_user_id === actor.userId),
          })),
        });
        await client.query('commit');
        return state;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async confirmFromBrowser(actor, sessionId, input, traceId) {
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        await client.query(`set local statement_timeout = '30000ms'`);
        const session = await lockBrowserSession(client, actor, sessionId, true);
        if (!session || session.actor_user_id !== actor.userId) {
          await client.query('rollback');
          return result('state_conflict');
        }
        const semantic = await promoteBrowserConfirmation(client, actor, session, input, traceId, now());
        await client.query('commit');
        return semantic;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async cancelFromBrowser(actor, sessionId, input, traceId) {
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        await client.query(`set local statement_timeout = '30000ms'`);
        const session = await lockBrowserSession(client, actor, sessionId, false);
        if (!session) {
          await client.query('rollback');
          return result('state_conflict');
        }
        if (
          session.version !== input.expectedVersion
          || !['pending', 'needs_confirmation', 'needs_review'].includes(session.state)
          || (actor.permissionLevel !== 'family_admin' && session.actor_user_id !== actor.userId)
        ) {
          await client.query('rollback');
          return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
        }
        const version = session.version + 1;
        const current = now();
        await client.query(
          `update voice_care_feeding_sessions
              set state = 'cancelled', cancelled_at = $2, updated_at = $2, version = $3
            where id = $1`,
          [session.id, current, version],
        );
        await writeAudit(client, {
          familyId: actor.familyId,
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId,
          action: 'voice_care.session_cancelled',
          targetType: 'voice_care_feeding_session',
          targetId: session.id,
          source: 'web',
          traceId,
          metadata: { reason: input.reason },
          occurredAt: current,
        });
        await client.query('commit');
        return result('accepted_pending', { careSessionId: session.id, sessionVersion: version });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function result(
  code: VoiceCareSemanticResultV1['code'],
  options: Partial<VoiceCareSemanticResultV1> = {},
): VoiceCareSemanticResultV1 {
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
    ...options,
  });
}

function storedProposal(input: Record<string, unknown>): VoiceCareFeedingProposalV1 {
  if (input.mode === 'bottle') {
    return VoiceCareFeedingProposalV1Schema.parse({
      ...input,
      amountValueOrigin: typeof input.amountMl === 'number' ? 'spoken' : null,
    });
  }
  return VoiceCareFeedingProposalV1Schema.parse(input);
}

function isReviewOnly(authenticated: AuthenticatedVoiceIntent): boolean {
  return authenticated.intent.deliveryMode === 'replay' || authenticated.intent.speakerState !== 'verified';
}

function readback(proposal: VoiceCareFeedingProposalV1): VoiceCareSemanticResultV1['readback'] {
  if (proposal.mode === 'bottle' && proposal.liquidType && proposal.amountMl) {
    return {
      templateId: 'feeding_bottle_readback',
      liquidType: proposal.liquidType,
      amountMl: proposal.amountMl,
      bottleCapacityMl: proposal.bottleCapacityMl,
    };
  }
  if (proposal.mode === 'direct_breastfeeding' && proposal.durationMinutes) {
    return { templateId: 'feeding_direct_readback', durationMinutes: proposal.durationMinutes };
  }
  return null;
}

function feedingInput(
  proposal: VoiceCareFeedingProposalV1,
  clientRequestId: string,
): CreateFeedingSessionInput {
  if (proposal.mode === 'bottle' && proposal.endedAt && proposal.liquidType && proposal.amountMl) {
    return {
      occurredAt: proposal.endedAt,
      clientRequestId,
      components: [{
        kind: 'bottle',
        liquidType: proposal.liquidType,
        amountMl: proposal.amountMl,
        ...(proposal.bottleCapacityMl === null ? {} : { bottleCapacityMl: proposal.bottleCapacityMl }),
      }],
    };
  }
  if (proposal.mode === 'direct_breastfeeding' && proposal.endedAt && proposal.durationMinutes) {
    return {
      occurredAt: proposal.endedAt,
      clientRequestId,
      components: [{ kind: 'direct_breastfeeding', durationMinutes: proposal.durationMinutes }],
    };
  }
  throw new Error('voice_care_final_proposal_invalid');
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
  session: VoiceCareSessionRow,
  confirmation: ConfirmVoiceCareSessionInput,
): boolean {
  const warningCodes = [...session.warning_codes_json].sort();
  const confirmedWarningCodes = [...confirmation.confirmedWarningCodes].sort();
  return session.final_care_event_id !== null
    && session.proposal_digest?.toString('hex') === confirmation.proposalDigest
    && (session.warning_digest?.toString('hex') ?? null) === confirmation.warningDigest
    && sameCodes(warningCodes, confirmedWarningCodes)
    && session.version === confirmation.expectedVersion + 1;
}

async function lockBrowserSession(
  client: pg.PoolClient,
  actor: CareActorContext,
  sessionId: string,
  requireSameActor: boolean,
): Promise<VoiceCareSessionRow | null> {
  const found = await client.query<VoiceCareSessionRow>(
    `select id, family_id, baby_id, device_id, lease_id, actor_user_id,
            actor_membership_id, state, proposal_json, version, proposal_digest,
            warning_digest, warning_codes_json, final_care_event_id, started_at,
            expires_at, ended_at, confirmed_at, cancelled_at
       from voice_care_feeding_sessions
      where id = $1 and family_id = $2 and baby_id = $3
        and ($4::boolean = false or actor_user_id = $5)
      for update`,
    [sessionId, actor.familyId, actor.babyId, requireSameActor, actor.userId],
  );
  return found.rows[0] ?? null;
}

async function promoteBrowserConfirmation(
  client: pg.PoolClient,
  actor: CareActorContext,
  session: VoiceCareSessionRow,
  confirmation: ConfirmVoiceCareSessionInput,
  traceId: string,
  current: Date,
): Promise<VoiceCareSemanticResultV1> {
  const proposalDigest = session.proposal_digest?.toString('hex') ?? null;
  if (session.state === 'committed' && committedConfirmationMatches(session, confirmation)) {
    return result('saved', {
      careSessionId: session.id,
      careEventId: session.final_care_event_id!,
      sessionVersion: session.version,
      proposalDigest,
      warningDigest: session.warning_digest?.toString('hex') ?? null,
      warningCodes: session.warning_codes_json as CareWarning['code'][],
      readback: readback(VoiceCareFeedingProposalV1Schema.parse(session.proposal_json)),
    });
  }
  if (
    !proposalDigest
    || proposalDigest !== confirmation.proposalDigest
    || session.version !== confirmation.expectedVersion
    || !['needs_confirmation', 'needs_review'].includes(session.state)
  ) {
    return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
  }
  const proposal = VoiceCareFeedingProposalV1Schema.parse(session.proposal_json);
  const input = feedingInput(proposal, randomUUID());
  const warnings = await collectFeedingWarnings(client, actor, input, current);
  const codes = warningCodes(warnings);
  const digest = codes.length === 0 ? null : warningSetDigest(codes);
  const suppliedCodes = [...confirmation.confirmedWarningCodes].sort();
  if (digest !== confirmation.warningDigest || !sameCodes(codes, suppliedCodes)) {
    if (codes.length === 0) {
      return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
    }
    const version = session.version + 1;
    await client.query(
      `update voice_care_feeding_sessions
          set state = 'needs_confirmation', warning_digest = $2,
              warning_codes_json = $3::jsonb, version = $4, updated_at = $5
        where id = $1`,
      [session.id, Buffer.from(digest!, 'hex'), JSON.stringify(codes), version, current],
    );
    return result('needs_confirmation', {
      careSessionId: session.id,
      sessionVersion: version,
      proposalDigest,
      warningDigest: digest,
      warningCodes: codes,
      readback: readback(proposal),
    });
  }
  await client.query(
    `update voice_care_feeding_sessions set state = 'committing', updated_at = $2 where id = $1`,
    [session.id, current],
  );
  const event = await writeFeedingSessionInTransaction(client, actor, input, traceId, 'voice');
  const version = session.version + 1;
  await client.query(
    `update voice_care_feeding_sessions
        set state = 'committed', final_care_event_id = $2, confirmed_at = $3,
            version = $4, updated_at = $3
      where id = $1`,
    [session.id, event.id, current, version],
  );
  await writeAudit(client, {
    familyId: actor.familyId,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId,
    action: 'voice_care.session_committed',
    targetType: 'voice_care_feeding_session',
    targetId: session.id,
    source: 'web',
    traceId,
    metadata: { careEventId: event.id },
    occurredAt: current,
  });
  return result('saved', {
    careSessionId: session.id,
    careEventId: event.id,
    sessionVersion: version,
    proposalDigest,
    warningDigest: digest,
    warningCodes: codes,
    readback: readback(proposal),
  });
}

export async function applyPendingVoiceIntent(
  client: pg.PoolClient,
  authenticated: AuthenticatedVoiceIntent,
  acceptedAt: Date,
  traceId: string,
): Promise<VoiceCareSemanticResultV1> {
  const { intent, actor, device, lease } = authenticated;
  await sweepExpiredVoiceCareSessions(client, device.familyId, acceptedAt);
  if (intent.speakerState === 'mismatch') return result('identity_mismatch');

  if (intent.intentType === 'feeding_start') {
    const proposal = intent.payload.mode === 'unknown'
      ? { mode: 'unknown' as const, startedAt: intent.payload.startedAt, endedAt: null }
      : intent.payload.mode === 'bottle'
        ? {
            mode: 'bottle' as const,
            startedAt: intent.payload.startedAt,
            endedAt: null,
            liquidType: null,
            amountMl: null,
            bottleCapacityMl: null,
            amountValueOrigin: null,
          }
        : {
            mode: 'direct_breastfeeding' as const,
            startedAt: intent.payload.startedAt,
            endedAt: null,
            durationMinutes: null,
          };
    const parsedProposal = VoiceCareFeedingProposalV1Schema.parse(proposal);
    const sessionId = randomUUID();
    const startedAt = new Date(intent.payload.startedAt);
    const state = isReviewOnly(authenticated) ? 'needs_review' : 'pending';
    await client.query(
      `insert into voice_care_feeding_sessions (
         id, family_id, baby_id, device_id, lease_id, actor_user_id,
         actor_membership_id, start_request_id, source, state, proposal_json,
         version, started_at, expires_at, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'voice',$9,$10,1,$11,$12,$13,$13)`,
      [
        sessionId,
        device.familyId,
        actor.babyId,
        device.id,
        lease.id,
        actor.userId,
        actor.membershipId,
        intent.requestId,
        state,
        parsedProposal,
        startedAt,
        new Date(startedAt.getTime() + SESSION_LIFETIME_MS),
        acceptedAt,
      ],
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
  const expectedVersion = intent.payload.expectedVersion;
  if (intent.intentType === 'care_confirm' && session.state === 'committed') {
    const storedDigest = session.proposal_digest?.toString('hex') ?? null;
    if (!committedConfirmationMatches(session, intent.payload)) {
      return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
    }
    return result('saved', {
      careSessionId: session.id,
      careEventId: session.final_care_event_id,
      sessionVersion: session.version,
      proposalDigest: storedDigest,
      warningDigest: session.warning_digest?.toString('hex') ?? null,
      warningCodes: session.warning_codes_json as CareWarning['code'][],
      readback: readback(VoiceCareFeedingProposalV1Schema.parse(session.proposal_json)),
    });
  }
  if (session.version !== expectedVersion || ['cancelled', 'committing', 'committed'].includes(session.state)) {
    return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
  }

  if (intent.intentType === 'care_confirm') {
    const proposalDigest = session.proposal_digest?.toString('hex') ?? null;
    if (!proposalDigest || proposalDigest !== intent.payload.proposalDigest) {
      return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
    }
    if (session.state === 'needs_review' || isReviewOnly(authenticated)) {
      return result('needs_confirmation', {
        careSessionId: session.id,
        sessionVersion: session.version,
        proposalDigest,
      });
    }
    const proposal = VoiceCareFeedingProposalV1Schema.parse(session.proposal_json);
    const input = feedingInput(proposal, intent.requestId);
    const warnings = await collectFeedingWarnings(client, actor, input, acceptedAt);
    const codes = warningCodes(warnings);
    const digest = codes.length === 0 ? null : warningSetDigest(codes);
    const suppliedCodes = [...intent.payload.confirmedWarningCodes].sort();
    const exactWarnings = digest === intent.payload.warningDigest && sameCodes(codes, suppliedCodes);
    if (!exactWarnings) {
      if (codes.length === 0) {
        return result('state_conflict', { careSessionId: session.id, sessionVersion: session.version });
      }
      const version = session.version + 1;
      await client.query(
        `update voice_care_feeding_sessions
            set state = 'needs_confirmation', warning_digest = $2,
                warning_codes_json = $3::jsonb, version = $4, updated_at = $5
          where id = $1`,
        [session.id, Buffer.from(digest!, 'hex'), JSON.stringify(codes), version, acceptedAt],
      );
      return result('needs_confirmation', {
        careSessionId: session.id,
        sessionVersion: version,
        proposalDigest,
        warningDigest: digest,
        warningCodes: codes,
        readback: readback(proposal),
      });
    }
    await client.query(
      `update voice_care_feeding_sessions set state = 'committing', updated_at = $2 where id = $1`,
      [session.id, acceptedAt],
    );
    const event = await writeFeedingSessionInTransaction(client, actor, input, traceId, 'voice');
    const version = session.version + 1;
    await client.query(
      `update voice_care_feeding_sessions
          set state = 'committed', final_care_event_id = $2, confirmed_at = $3,
              version = $4, updated_at = $3
        where id = $1`,
      [session.id, event.id, acceptedAt, version],
    );
    await writeAudit(client, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      action: 'voice_care.session_committed',
      targetType: 'voice_care_feeding_session',
      targetId: session.id,
      source: 'api',
      traceId,
      metadata: { careEventId: event.id },
      occurredAt: acceptedAt,
    });
    return result('saved', {
      careSessionId: session.id,
      careEventId: event.id,
      sessionVersion: version,
      proposalDigest,
      warningDigest: digest,
      warningCodes: codes,
      readback: readback(proposal),
    });
  }

  if (intent.intentType === 'care_cancel') {
    if (isReviewOnly(authenticated)) {
      return result('needs_confirmation', { careSessionId: session.id, sessionVersion: session.version });
    }
    const version = session.version + 1;
    await client.query(
      `update voice_care_feeding_sessions
          set state = 'cancelled', cancelled_at = $2, updated_at = $2, version = $3
        where id = $1`,
      [session.id, acceptedAt, version],
    );
    return result('accepted_pending', { careSessionId: session.id, sessionVersion: version });
  }

  const proposalInput = intent.intentType === 'feeding_update'
    ? intent.payload.proposal
    : intent.payload.finalProposal;
  const proposal = storedProposal(proposalInput);
  const version = session.version + 1;
  if (intent.intentType === 'feeding_update') {
    const state = session.state === 'needs_review' || isReviewOnly(authenticated) ? 'needs_review' : 'pending';
    await client.query(
      `update voice_care_feeding_sessions
          set proposal_json = $2, state = $3, version = $4, updated_at = $5
        where id = $1`,
      [session.id, proposal, state, version, acceptedAt],
    );
    return result(state === 'needs_review' ? 'needs_confirmation' : 'accepted_pending', {
      careSessionId: session.id,
      sessionVersion: version,
    });
  }

  const digest = await voiceCareProposalDigestV1(proposal);
  const state = session.state === 'needs_review' || isReviewOnly(authenticated)
    ? 'needs_review'
    : 'needs_confirmation';
  await client.query(
    `update voice_care_feeding_sessions
        set proposal_json = $2, proposal_digest = $3, state = $4,
            ended_at = $5, version = $6, updated_at = $7
      where id = $1`,
    [session.id, proposal, Buffer.from(digest, 'hex'), state, new Date(proposal.endedAt!), version, acceptedAt],
  );
  return result('needs_confirmation', {
    careSessionId: session.id,
    sessionVersion: version,
    proposalDigest: digest,
    readback: readback(proposal),
  });
}
