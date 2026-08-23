import { isDeepStrictEqual } from 'node:util';
import type pg from 'pg';
import { EditCareEventInputSchema } from '@baby-care/contracts';
import type {
  CareEventType,
  CareSource,
  FeedingComponentInput,
  FeedingRelatedActionInput,
  FamilyExportV1,
} from '@baby-care/contracts';

export type FamilyExportRows = Pick<
  FamilyExportV1,
  'family' | 'baby' | 'members' | 'careEvents' | 'careRevisions' | 'handoffCheckpoints' | 'handoffReminderRules'
>;

export interface FamilyExportRepository {
  readFamilyExport(client: pg.PoolClient, familyId: string): Promise<FamilyExportRows>;
}

interface HouseholdRow extends pg.QueryResultRow {
  family_id: string;
  family_name: string;
  family_timezone: string;
  family_status: string;
  family_created_at: Date;
  family_updated_at: Date;
  baby_id: string;
  baby_family_id: string;
  baby_display_name: string;
  baby_birth_date: string | null;
  baby_status: string;
  baby_created_at: Date;
  baby_updated_at: Date;
  membership_id: string | null;
  membership_family_id: string | null;
  member_user_id: string | null;
  member_display_name: string | null;
  relationship: string | null;
  permission_level: string | null;
  membership_status: string | null;
  membership_created_at: Date | null;
  membership_updated_at: Date | null;
}

interface EventRow extends pg.QueryResultRow {
  id: string;
  family_id: string;
  baby_id: string;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  actor_display_name: string | null;
  actor_membership_family_id: string | null;
  actor_membership_user_id: string | null;
  source: string;
  event_type: string;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
  status: string;
  version: number;
  note: string | null;
}

interface FeedingRow extends pg.QueryResultRow {
  event_id: string;
  event_type: string;
  row_kind: 'session' | 'component' | 'related_action';
  sort_at: Date | null;
  sort_id: string;
  component_type: string | null;
  liquid_type: string | null;
  amount_ml: number | null;
  duration_minutes: number | null;
  bottle_capacity_ml: number | null;
  related_event_id: string | null;
  related_family_id: string | null;
  related_baby_id: string | null;
  related_status: string | null;
  related_event_type: string | null;
  action_type: string | null;
  spit_up_amount: string | null;
}

interface DiaperRow extends pg.QueryResultRow {
  event_id: string;
  event_type: string;
  kind: string;
  stool_color: string | null;
  stool_consistency: string | null;
  stool_amount: string | null;
}

interface SleepRow extends pg.QueryResultRow {
  event_id: string;
  event_type: string;
  started_at: Date;
  ended_at: Date | null;
}

interface ActionRow extends pg.QueryResultRow {
  event_id: string;
  event_type: string;
  action_type: string;
  feeding_session_event_id: string | null;
  spit_up_amount: string | null;
  crying_duration_minutes: number | null;
  medication_name: string | null;
  medication_dose: number | null;
  medication_dose_unit: string | null;
}

interface MeasurementRow extends pg.QueryResultRow {
  event_id: string;
  event_type: string;
  measurement_type: string;
  value: number;
  method: string | null;
}

interface RevisionRow extends pg.QueryResultRow {
  id: string;
  event_id: string;
  actor_user_id: string;
  actor_membership_id: string;
  actor_display_name: string | null;
  actor_membership_family_id: string | null;
  actor_membership_user_id: string | null;
  revision_action: string;
  from_version: number;
  to_version: number;
  before_json: unknown;
  after_json: unknown;
  trace_id: string;
  operation_created_at: string;
  created_at: Date;
}

interface HandoffRow extends pg.QueryResultRow {
  id: string;
  family_id: string;
  baby_id: string;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  actor_display_name: string | null;
  actor_membership_family_id: string | null;
  actor_membership_user_id: string | null;
  source: string;
  occurred_at: Date;
  created_at: Date;
}

interface ReminderRow extends pg.QueryResultRow {
  id: string;
  family_id: string;
  baby_id: string;
  actor_user_id: string;
  actor_membership_id: string;
  actor_display_name: string | null;
  actor_membership_family_id: string | null;
  actor_membership_user_id: string | null;
  local_time: string;
  weekday_mask: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

type ExportEvent = FamilyExportRows['careEvents'][number];
type ExportPayload = ExportEvent['payload'];

interface NormalizedCareFact {
  eventType: CareEventType;
  occurredAt: string;
  note: string | null;
  payload: unknown;
}

function closed(message: string): never {
  throw new Error(`Family export validation failed: ${message}`);
}

function iso(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) closed('invalid database timestamp');
  return value.toISOString();
}

function assertActorOwnership(
  familyId: string,
  actorUserId: string | null,
  actorMembershipId: string | null,
  actorDisplayName: string | null,
  membershipFamilyId: string | null,
  membershipUserId: string | null,
): void {
  if (actorUserId === null || actorMembershipId === null) {
    if (actorUserId !== null || actorMembershipId !== null || actorDisplayName !== null) {
      closed('partial actor identity');
    }
    return;
  }
  if (actorDisplayName === null || membershipFamilyId !== familyId || membershipUserId !== actorUserId) {
    closed('actor membership ownership mismatch');
  }
}

function actionPayload(row: ActionRow): ExportPayload {
  if (row.event_type !== row.action_type) closed('action kind does not match event kind');
  switch (row.action_type) {
    case 'burping':
      return { action: { kind: 'burping' } };
    case 'spit_up':
      return { action: { kind: 'spit_up', amount: row.spit_up_amount as 'small' | 'medium' | 'large' } };
    case 'crying':
      return {
        action: {
          kind: 'crying',
          ...(row.crying_duration_minutes === null ? {} : { durationMinutes: row.crying_duration_minutes }),
        },
      };
    case 'bathing':
      return { action: { kind: 'bathing' } };
    case 'medication':
      return {
        action: {
          kind: 'medication',
          medicationName: row.medication_name as string,
          dose: row.medication_dose as number,
          doseUnit: row.medication_dose_unit as string,
        },
      };
    default:
      return closed('unknown action kind');
  }
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  return (left ?? -1) - (right ?? -1);
}

function compareFeedingComponents(left: FeedingComponentInput, right: FeedingComponentInput): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.kind === 'direct_breastfeeding' && right.kind === 'direct_breastfeeding') {
    return left.durationMinutes - right.durationMinutes;
  }
  if (left.kind === 'bottle' && right.kind === 'bottle') {
    return left.liquidType.localeCompare(right.liquidType)
      || left.amountMl - right.amountMl
      || compareOptionalNumber(left.bottleCapacityMl, right.bottleCapacityMl);
  }
  return 0;
}

function compareFeedingActions(left: FeedingRelatedActionInput, right: FeedingRelatedActionInput): number {
  if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
  if (left.kind === 'spit_up' && right.kind === 'spit_up') return left.amount.localeCompare(right.amount);
  return 0;
}

function normalizedInstant(value: string): string {
  return new Date(value).toISOString();
}

function normalizedSnapshot(value: unknown, eventType: CareEventType): NormalizedCareFact {
  const parsed = EditCareEventInputSchema.safeParse(value);
  if (!parsed.success || parsed.data.eventType !== eventType) closed('revision snapshot kind mismatch');
  const snapshot = parsed.data;
  if (snapshot.eventType === 'feeding') {
    return {
      eventType,
      occurredAt: normalizedInstant(snapshot.occurredAt),
      note: snapshot.note ?? null,
      payload: {
        components: [...snapshot.components].sort(compareFeedingComponents),
        relatedActions: [...(snapshot.relatedActions ?? [])].sort(compareFeedingActions),
      },
    };
  }
  if (snapshot.eventType === 'diaper') {
    return {
      eventType,
      occurredAt: normalizedInstant(snapshot.occurredAt),
      note: snapshot.note ?? null,
      payload: {
        kind: snapshot.kind,
        stoolColor: snapshot.stoolColor ?? null,
        stoolConsistency: snapshot.stoolConsistency ?? null,
        stoolAmount: snapshot.stoolAmount ?? null,
      },
    };
  }
  if (snapshot.eventType === 'sleep') {
    return {
      eventType,
      occurredAt: normalizedInstant(snapshot.startedAt),
      note: snapshot.note ?? null,
      payload: {
        startedAt: normalizedInstant(snapshot.startedAt),
        endedAt: snapshot.endedAt ? normalizedInstant(snapshot.endedAt) : null,
      },
    };
  }
  if ('action' in snapshot) {
    return {
      eventType,
      occurredAt: normalizedInstant(snapshot.occurredAt),
      note: snapshot.note ?? null,
      payload: { action: snapshot.action },
    };
  }
  return {
    eventType,
    occurredAt: normalizedInstant(snapshot.occurredAt),
    note: snapshot.note ?? null,
    payload: { measurement: snapshot.measurement },
  };
}

function normalizedCurrentFact(event: ExportEvent): NormalizedCareFact {
  if (event.eventType === 'feeding') {
    return {
      eventType: event.eventType,
      occurredAt: normalizedInstant(event.occurredAt),
      note: event.note,
      payload: {
        components: [...event.payload.components].sort(compareFeedingComponents),
        relatedActions: [...event.payload.relatedActions].sort(compareFeedingActions),
      },
    };
  }
  if (event.eventType === 'sleep') {
    return {
      eventType: event.eventType,
      occurredAt: normalizedInstant(event.occurredAt),
      note: event.note,
      payload: {
        startedAt: normalizedInstant(event.payload.startedAt),
        endedAt: event.payload.endedAt ? normalizedInstant(event.payload.endedAt) : null,
      },
    };
  }
  return {
    eventType: event.eventType,
    occurredAt: normalizedInstant(event.occurredAt),
    note: event.note,
    payload: event.payload,
  };
}

function feedingStoredFact(fact: NormalizedCareFact): NormalizedCareFact {
  const payload = fact.payload as { components: FeedingComponentInput[] };
  return { ...fact, payload: { components: payload.components } };
}

function feedingRelatedActions(fact: NormalizedCareFact): FeedingRelatedActionInput[] {
  const payload = fact.payload as { relatedActions: FeedingRelatedActionInput[] };
  return payload.relatedActions;
}

function feedingActionFromChildVoid(revision: RevisionRow, child: EventRow): FeedingRelatedActionInput {
  const fact = normalizedSnapshot(revision.before_json, child.event_type as CareEventType);
  const action = (fact.payload as { action?: FeedingRelatedActionInput }).action;
  if (child.event_type === 'burping' && action?.kind === 'burping') return { kind: 'burping' };
  if (child.event_type === 'spit_up' && action?.kind === 'spit_up') {
    return { kind: 'spit_up', amount: action.amount };
  }
  return closed('feeding undo child revision kind mismatch');
}

function validateRevisionChains(
  events: ReadonlyMap<string, EventRow>,
  revisions: readonly RevisionRow[],
  exportedEvents: ReadonlyMap<string, ExportEvent>,
  relatedChildrenByFeeding: ReadonlyMap<string, readonly string[]>,
): void {
  const byEvent = new Map<string, RevisionRow[]>();
  for (const revision of revisions) {
    const event = events.get(revision.event_id);
    if (!event) closed('revision references an event outside the export');
    if (revision.actor_display_name === null
      || revision.actor_membership_family_id !== event.family_id
      || revision.actor_membership_user_id !== revision.actor_user_id) {
      closed('revision actor ownership mismatch');
    }
    const list = byEvent.get(revision.event_id) ?? [];
    list.push(revision);
    byEvent.set(revision.event_id, list);
  }

  for (const event of events.values()) {
    const chain = (byEvent.get(event.id) ?? []).sort((left, right) => left.from_version - right.from_version);
    const exportedEvent = exportedEvents.get(event.id);
    if (!exportedEvent) closed('revision event fact is missing');
    if (chain.length !== event.version - 1) closed('revision count does not match event version');
    let priorAfter: NormalizedCareFact | undefined;
    let finalFact: NormalizedCareFact | undefined;
    for (const [index, revision] of chain.entries()) {
      const expectedFrom = index + 1;
      if (revision.from_version !== expectedFrom || revision.to_version !== expectedFrom + 1) {
        closed('revision version edge is not contiguous');
      }
      const before = normalizedSnapshot(revision.before_json, event.event_type as CareEventType);
      if (priorAfter && !isDeepStrictEqual(priorAfter, before)) {
        closed('revision snapshots are not causally contiguous');
      }
      if (revision.revision_action === 'edit') {
        const after = normalizedSnapshot(revision.after_json, event.event_type as CareEventType);
        priorAfter = after;
        finalFact = after;
      } else if (revision.revision_action === 'void') {
        const afterStatus = (revision.after_json as { status?: unknown } | null)?.status;
        if (index !== chain.length - 1 || afterStatus !== 'voided') closed('invalid void revision edge');
        finalFact = before;
        priorAfter = undefined;
      } else {
        closed('unknown revision action');
      }
    }
    const hasVoid = chain.some((revision) => revision.revision_action === 'void');
    if ((event.status === 'voided') !== hasVoid) closed('event status does not match revision chain');
    if (hasVoid && event.event_type === 'feeding' && finalFact) {
      const terminalRevision = chain.at(-1);
      if (!terminalRevision || terminalRevision.revision_action !== 'void') closed('feeding void revision is missing');
      const childActions: FeedingRelatedActionInput[] = [];
      for (const childId of relatedChildrenByFeeding.get(event.id) ?? []) {
        const child = events.get(childId);
        if (!child) closed('feeding undo child is missing');
        if (child.status !== 'voided') closed('voided feeding has an active linked child');
        const matchingVoids = (byEvent.get(childId) ?? []).filter((revision) => (
          revision.revision_action === 'void'
          && revision.to_version === child.version
          && revision.trace_id === terminalRevision.trace_id
          && revision.operation_created_at === terminalRevision.operation_created_at
          && revision.actor_user_id === terminalRevision.actor_user_id
          && revision.actor_membership_id === terminalRevision.actor_membership_id
        ));
        if (matchingVoids.length > 1) closed('duplicate feeding undo child revision');
        if (matchingVoids[0]) childActions.push(feedingActionFromChildVoid(matchingVoids[0], child));
      }
      childActions.sort(compareFeedingActions);
      if (!isDeepStrictEqual(feedingRelatedActions(finalFact), childActions)) {
        closed('feeding undo relations do not match child revisions');
      }
    }
    const currentFact = normalizedCurrentFact(exportedEvent);
    const expectedFinalFact = hasVoid && event.event_type === 'feeding' && finalFact
      ? feedingStoredFact(finalFact)
      : finalFact;
    const comparableCurrentFact = hasVoid && event.event_type === 'feeding'
      ? feedingStoredFact(currentFact)
      : currentFact;
    if (expectedFinalFact && !isDeepStrictEqual(expectedFinalFact, comparableCurrentFact)) {
      closed('latest revision snapshot does not match the current typed fact');
    }
  }
}

async function readHousehold(client: pg.PoolClient, familyId: string) {
  return client.query<HouseholdRow>(
    `select f.id as family_id, f.name as family_name, f.timezone as family_timezone,
            f.status::text as family_status, f.created_at as family_created_at,
            f.updated_at as family_updated_at,
            b.id as baby_id, b.family_id as baby_family_id, b.display_name as baby_display_name,
            b.birth_date::text as baby_birth_date, b.status::text as baby_status,
            b.created_at as baby_created_at, b.updated_at as baby_updated_at,
            fm.id as membership_id, fm.family_id as membership_family_id,
            fm.user_id as member_user_id, u.display_name as member_display_name,
            fm.relationship::text as relationship, fm.permission_level::text as permission_level,
            fm.status::text as membership_status,
            fm.created_at as membership_created_at, fm.updated_at as membership_updated_at
       from families f
       join babies b on b.family_id = f.id and b.status = 'active'
       left join family_memberships fm on fm.family_id = f.id
       left join users u on u.id = fm.user_id
      where f.id = $1 and f.status = 'active'
      order by b.id, fm.id`,
    [familyId],
  );
}

async function readEvents(client: pg.PoolClient, familyId: string) {
  return client.query<EventRow>(
    `select ce.id, ce.family_id, ce.baby_id, ce.actor_user_id, ce.actor_membership_id,
            u.display_name as actor_display_name,
            am.family_id as actor_membership_family_id, am.user_id as actor_membership_user_id,
            ce.source::text as source, ce.event_type::text as event_type,
            ce.occurred_at, ce.created_at, ce.updated_at,
            ce.status::text as status, ce.version, ce.note
       from care_events ce
       left join users u on u.id = ce.actor_user_id
       left join family_memberships am on am.id = ce.actor_membership_id
      where ce.family_id = $1
      order by ce.id`,
    [familyId],
  );
}

async function readFeeding(client: pg.PoolClient, familyId: string) {
  return client.query<FeedingRow>(
    `select fs.event_id, ce.event_type::text as event_type, 'session'::text as row_kind,
            null::timestamptz as sort_at, fs.event_id::text as sort_id,
            null::text as component_type, null::text as liquid_type,
            null::int as amount_ml, null::int as duration_minutes, null::int as bottle_capacity_ml,
            null::uuid as related_event_id, null::uuid as related_family_id, null::uuid as related_baby_id,
            null::text as related_status, null::text as related_event_type,
            null::text as action_type, null::text as spit_up_amount
       from feeding_sessions fs
       join care_events ce on ce.id = fs.event_id
      where ce.family_id = $1
      union all
     select fc.session_event_id, ce.event_type::text, 'component'::text,
            fc.occurred_at, fc.id::text,
            fc.component_type::text, fc.liquid_type::text,
            fc.amount_ml, fc.duration_minutes, fc.bottle_capacity_ml,
            null::uuid, null::uuid, null::uuid, null::text, null::text, null::text, null::text
       from feeding_components fc
       join care_events ce on ce.id = fc.session_event_id
      where ce.family_id = $1
      union all
     select ca.feeding_session_event_id, parent.event_type::text, 'related_action'::text,
            child.created_at, child.id::text,
            null::text, null::text, null::int, null::int, null::int,
            child.id, child.family_id, child.baby_id, child.status::text, child.event_type::text,
            ca.action_type::text, ca.spit_up_amount::text
       from care_actions ca
       join care_events parent on parent.id = ca.feeding_session_event_id
       join care_events child on child.id = ca.event_id
      where parent.family_id = $1 and ca.feeding_session_event_id is not null
      order by event_id, row_kind, sort_at, sort_id`,
    [familyId],
  );
}

async function readDiapers(client: pg.PoolClient, familyId: string) {
  return client.query<DiaperRow>(
    `select de.event_id, ce.event_type::text as event_type,
            de.kind::text as kind, de.stool_color, de.stool_consistency, de.stool_amount
       from diaper_events de
       join care_events ce on ce.id = de.event_id
      where ce.family_id = $1
      order by de.event_id`,
    [familyId],
  );
}

async function readSleep(client: pg.PoolClient, familyId: string) {
  return client.query<SleepRow>(
    `select si.event_id, ce.event_type::text as event_type, si.started_at, si.ended_at
       from sleep_intervals si
       join care_events ce on ce.id = si.event_id
      where ce.family_id = $1
      order by si.event_id`,
    [familyId],
  );
}

async function readActions(client: pg.PoolClient, familyId: string) {
  return client.query<ActionRow>(
    `select ca.event_id, ce.event_type::text as event_type, ca.action_type::text as action_type,
            ca.feeding_session_event_id, ca.spit_up_amount::text as spit_up_amount,
            ca.crying_duration_minutes, ca.medication_name,
            ca.medication_dose::float8 as medication_dose, ca.medication_dose_unit
       from care_actions ca
       join care_events ce on ce.id = ca.event_id
      where ce.family_id = $1
      order by ca.event_id`,
    [familyId],
  );
}

async function readMeasurements(client: pg.PoolClient, familyId: string) {
  return client.query<MeasurementRow>(
    `select m.event_id, ce.event_type::text as event_type,
            m.measurement_type::text as measurement_type,
            m.value::float8 as value, m.method
       from measurements m
       join care_events ce on ce.id = m.event_id
      where ce.family_id = $1
      order by m.event_id`,
    [familyId],
  );
}

async function readRevisions(client: pg.PoolClient, familyId: string) {
  return client.query<RevisionRow>(
    `select cr.id, cr.event_id, cr.edit_actor_user_id as actor_user_id,
            cr.edit_actor_membership_id as actor_membership_id,
            u.display_name as actor_display_name,
            am.family_id as actor_membership_family_id, am.user_id as actor_membership_user_id,
            cr.revision_action::text as revision_action,
            cr.from_version, cr.to_version, cr.before_json, cr.after_json, cr.trace_id,
            cr.created_at::text as operation_created_at, cr.created_at
       from care_event_revisions cr
       join care_events ce on ce.id = cr.event_id
       left join users u on u.id = cr.edit_actor_user_id
       left join family_memberships am on am.id = cr.edit_actor_membership_id
      where ce.family_id = $1
      order by cr.event_id, cr.from_version, cr.id`,
    [familyId],
  );
}

async function readHandoffs(client: pg.PoolClient, familyId: string) {
  return client.query<HandoffRow>(
    `select hc.id, hc.family_id, hc.baby_id, hc.actor_user_id, hc.actor_membership_id,
            u.display_name as actor_display_name,
            am.family_id as actor_membership_family_id, am.user_id as actor_membership_user_id,
            hc.source::text as source, hc.occurred_at, hc.created_at
       from care_handoff_checkpoints hc
       left join users u on u.id = hc.actor_user_id
       left join family_memberships am on am.id = hc.actor_membership_id
      where hc.family_id = $1
      order by hc.id`,
    [familyId],
  );
}

async function readReminders(client: pg.PoolClient, familyId: string) {
  return client.query<ReminderRow>(
    `select hr.id, hr.family_id, hr.baby_id, hr.actor_user_id, hr.actor_membership_id,
            u.display_name as actor_display_name,
            am.family_id as actor_membership_family_id, am.user_id as actor_membership_user_id,
            hr.local_time, hr.weekday_mask, hr.enabled, hr.created_at, hr.updated_at
       from care_handoff_reminder_rules hr
       left join users u on u.id = hr.actor_user_id
       left join family_memberships am on am.id = hr.actor_membership_id
      where hr.family_id = $1
      order by hr.id`,
    [familyId],
  );
}

async function readFamilyExport(client: pg.PoolClient, familyId: string): Promise<FamilyExportRows> {
  const householdResult = await readHousehold(client, familyId);
  const householdRows = householdResult.rows;
  if (householdRows.length === 0) closed('one active family and baby are required');
  const householdKeys = new Set(householdRows.map((row) => `${row.family_id}:${row.baby_id}`));
  if (householdKeys.size !== 1) closed('multiple active family or baby rows');
  const household = householdRows[0]!;
  if (household.family_id !== familyId || household.baby_family_id !== familyId) {
    closed('household ownership mismatch');
  }

  const members: FamilyExportRows['members'] = [];
  const memberIds = new Set<string>();
  for (const row of householdRows) {
    if (row.membership_id === null) continue;
    if (row.membership_family_id !== familyId || row.member_user_id === null || row.member_display_name === null
      || row.relationship === null || row.permission_level === null || row.membership_status === null
      || row.membership_created_at === null || row.membership_updated_at === null) {
      closed('incomplete family membership');
    }
    if (memberIds.has(row.membership_id)) continue;
    memberIds.add(row.membership_id);
    members.push({
      membershipId: row.membership_id,
      familyId: row.membership_family_id,
      userId: row.member_user_id,
      displayName: row.member_display_name,
      relationship: row.relationship as FamilyExportRows['members'][number]['relationship'],
      permissionLevel: row.permission_level as FamilyExportRows['members'][number]['permissionLevel'],
      status: row.membership_status as FamilyExportRows['members'][number]['status'],
      createdAt: iso(row.membership_created_at),
      updatedAt: iso(row.membership_updated_at),
    });
  }

  const eventsResult = await readEvents(client, familyId);
  const events = new Map<string, EventRow>();
  for (const row of eventsResult.rows) {
    if (events.has(row.id)) closed('duplicate care event envelope');
    if (row.family_id !== familyId || row.baby_id !== household.baby_id) closed('care event ownership mismatch');
    assertActorOwnership(
      familyId,
      row.actor_user_id,
      row.actor_membership_id,
      row.actor_display_name,
      row.actor_membership_family_id,
      row.actor_membership_user_id,
    );
    events.set(row.id, row);
  }

  const feedingRows = (await readFeeding(client, familyId)).rows;
  const diaperRows = (await readDiapers(client, familyId)).rows;
  const sleepRows = (await readSleep(client, familyId)).rows;
  const actionRows = (await readActions(client, familyId)).rows;
  const measurementRows = (await readMeasurements(client, familyId)).rows;
  const revisionRows = (await readRevisions(client, familyId)).rows;
  const handoffRows = (await readHandoffs(client, familyId)).rows;
  const reminderRows = (await readReminders(client, familyId)).rows;

  const feeding = new Map<string, { sessionCount: number; components: unknown[]; relatedActions: unknown[] }>();
  const relatedChildrenByFeeding = new Map<string, string[]>();
  for (const row of feedingRows) {
    const event = events.get(row.event_id);
    if (!event || row.event_type !== 'feeding' || event.event_type !== 'feeding') {
      closed('feeding detail kind mismatch');
    }
    const payload = feeding.get(row.event_id) ?? { sessionCount: 0, components: [], relatedActions: [] };
    feeding.set(row.event_id, payload);
    if (row.row_kind === 'session') {
      payload.sessionCount += 1;
    } else if (row.row_kind === 'component') {
      if (row.component_type === 'direct_breastfeeding') {
        payload.components.push({ kind: 'direct_breastfeeding', durationMinutes: row.duration_minutes });
      } else if (row.component_type === 'bottle') {
        payload.components.push({
          kind: 'bottle',
          liquidType: row.liquid_type,
          amountMl: row.amount_ml,
          ...(row.bottle_capacity_ml === null ? {} : { bottleCapacityMl: row.bottle_capacity_ml }),
        });
      } else {
        closed('unknown feeding component kind');
      }
    } else if (row.row_kind === 'related_action') {
      const related = row.related_event_id ? events.get(row.related_event_id) : undefined;
      if (!related || row.related_family_id !== familyId || row.related_baby_id !== household.baby_id
        || row.related_event_type !== row.action_type || related.event_type !== row.action_type) {
        closed('feeding related action ownership or kind mismatch');
      }
      if (row.action_type !== 'burping' && row.action_type !== 'spit_up') {
        closed('unknown feeding related action kind');
      }
      const childIds = relatedChildrenByFeeding.get(row.event_id) ?? [];
      childIds.push(related.id);
      relatedChildrenByFeeding.set(row.event_id, childIds);
      if (row.related_status === 'active') {
        if (row.action_type === 'burping') payload.relatedActions.push({ kind: 'burping' });
        else {
          payload.relatedActions.push({ kind: 'spit_up', amount: row.spit_up_amount });
        }
      } else if (row.related_status !== 'voided') {
        closed('unknown feeding related action status');
      }
    } else {
      closed('unknown feeding row kind');
    }
  }

  const diapers = new Map<string, ExportPayload>();
  for (const row of diaperRows) {
    if (row.event_type !== 'diaper' || events.get(row.event_id)?.event_type !== 'diaper' || diapers.has(row.event_id)) {
      closed('diaper detail kind mismatch');
    }
    diapers.set(row.event_id, {
      kind: row.kind as 'urine' | 'stool' | 'urine_stool',
      stoolColor: row.stool_color,
      stoolConsistency: row.stool_consistency,
      stoolAmount: row.stool_amount,
    });
  }

  const sleeps = new Map<string, ExportPayload>();
  for (const row of sleepRows) {
    if (row.event_type !== 'sleep' || events.get(row.event_id)?.event_type !== 'sleep' || sleeps.has(row.event_id)) {
      closed('sleep detail kind mismatch');
    }
    sleeps.set(row.event_id, { startedAt: iso(row.started_at), endedAt: row.ended_at ? iso(row.ended_at) : null });
  }

  const actions = new Map<string, ExportPayload>();
  for (const row of actionRows) {
    if (actions.has(row.event_id) || !events.has(row.event_id)) closed('duplicate or orphan action detail');
    actions.set(row.event_id, actionPayload(row));
  }

  const measurements = new Map<string, ExportPayload>();
  for (const row of measurementRows) {
    if (measurements.has(row.event_id) || !events.has(row.event_id) || row.event_type !== row.measurement_type) {
      closed('measurement detail kind mismatch');
    }
    if (row.measurement_type === 'temperature') {
      measurements.set(row.event_id, {
        measurement: {
          kind: 'temperature',
          valueCelsius: row.value,
          ...(row.method === null ? {} : { method: row.method }),
        },
      });
    } else if (row.measurement_type === 'weight') {
      measurements.set(row.event_id, { measurement: { kind: 'weight', valueKg: row.value } });
    } else {
      closed('unknown measurement kind');
    }
  }

  const careEvents: FamilyExportRows['careEvents'] = [];
  for (const event of events.values()) {
    let payload: ExportPayload | undefined;
    switch (event.event_type) {
      case 'feeding': {
        const value = feeding.get(event.id);
        if (value?.sessionCount !== 1) closed('feeding event does not have one session detail');
        payload = { components: value.components, relatedActions: value.relatedActions } as ExportPayload;
        break;
      }
      case 'diaper': payload = diapers.get(event.id); break;
      case 'sleep': payload = sleeps.get(event.id); break;
      case 'burping':
      case 'spit_up':
      case 'crying':
      case 'bathing':
      case 'medication': payload = actions.get(event.id); break;
      case 'temperature':
      case 'weight': payload = measurements.get(event.id); break;
      default: closed('unknown care event kind');
    }
    if (!payload) closed('care event typed detail is missing');
    careEvents.push({
      id: event.id,
      familyId: event.family_id,
      babyId: event.baby_id,
      actorUserId: event.actor_user_id,
      actorMembershipId: event.actor_membership_id,
      actorDisplayName: event.actor_display_name,
      source: event.source as CareSource,
      eventType: event.event_type as CareEventType,
      occurredAt: iso(event.occurred_at),
      createdAt: iso(event.created_at),
      updatedAt: iso(event.updated_at),
      status: event.status as ExportEvent['status'],
      version: event.version,
      note: event.note,
      payload,
    } as ExportEvent);
  }

  validateRevisionChains(
    events,
    revisionRows,
    new Map(careEvents.map((event) => [event.id, event])),
    relatedChildrenByFeeding,
  );
  const careRevisions: FamilyExportRows['careRevisions'] = revisionRows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    actorUserId: row.actor_user_id,
    actorMembershipId: row.actor_membership_id,
    actorDisplayName: row.actor_display_name as string,
    action: row.revision_action as FamilyExportRows['careRevisions'][number]['action'],
    fromVersion: row.from_version,
    toVersion: row.to_version,
    before: row.before_json as FamilyExportRows['careRevisions'][number]['before'],
    after: row.after_json as FamilyExportRows['careRevisions'][number]['after'],
    createdAt: iso(row.created_at),
  }));

  const handoffCheckpoints: FamilyExportRows['handoffCheckpoints'] = handoffRows.map((row) => {
    if (row.family_id !== familyId || row.baby_id !== household.baby_id) closed('handoff ownership mismatch');
    assertActorOwnership(
      familyId,
      row.actor_user_id,
      row.actor_membership_id,
      row.actor_display_name,
      row.actor_membership_family_id,
      row.actor_membership_user_id,
    );
    return {
      id: row.id,
      familyId: row.family_id,
      babyId: row.baby_id,
      actorUserId: row.actor_user_id,
      actorMembershipId: row.actor_membership_id,
      actorDisplayName: row.actor_display_name,
      source: row.source as CareSource,
      occurredAt: iso(row.occurred_at),
      createdAt: iso(row.created_at),
    };
  });

  const handoffReminderRules: FamilyExportRows['handoffReminderRules'] = reminderRows.map((row) => {
    if (row.family_id !== familyId || row.baby_id !== household.baby_id || row.actor_display_name === null
      || row.actor_membership_family_id !== familyId || row.actor_membership_user_id !== row.actor_user_id) {
      closed('reminder ownership mismatch');
    }
    return {
      id: row.id,
      familyId: row.family_id,
      babyId: row.baby_id,
      actorUserId: row.actor_user_id,
      actorMembershipId: row.actor_membership_id,
      actorDisplayName: row.actor_display_name,
      localTime: row.local_time,
      weekdayMask: row.weekday_mask,
      enabled: row.enabled,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  });

  return {
    family: {
      id: household.family_id,
      name: household.family_name,
      timezone: household.family_timezone,
      status: household.family_status as 'active',
      createdAt: iso(household.family_created_at),
      updatedAt: iso(household.family_updated_at),
    },
    baby: {
      id: household.baby_id,
      familyId: household.baby_family_id,
      displayName: household.baby_display_name,
      birthDate: household.baby_birth_date,
      status: household.baby_status as 'active',
      createdAt: iso(household.baby_created_at),
      updatedAt: iso(household.baby_updated_at),
    },
    members,
    careEvents,
    careRevisions,
    handoffCheckpoints,
    handoffReminderRules,
  };
}

export function createFamilyExportRepository(): FamilyExportRepository {
  return { readFamilyExport };
}
