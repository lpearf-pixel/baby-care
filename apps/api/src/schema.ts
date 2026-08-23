import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const familyStatus = pgEnum('family_status', ['active']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
export const membershipStatus = pgEnum('membership_status', ['active', 'disabled']);
export const relationship = pgEnum('relationship', ['dad', 'mom', 'nanny']);
export const permissionLevel = pgEnum('permission_level', ['family_admin', 'caregiver']);
export const babyStatus = pgEnum('baby_status', ['active']);
export const auditSource = pgEnum('audit_source', ['web', 'api', 'system']);

export const careSource = pgEnum('care_source', ['manual', 'guardian', 'device', 'import', 'ai', 'voice']);
export const careEventStatus = pgEnum('care_event_status', ['active', 'voided']);
export const careEventType = pgEnum('care_event_type', [
  'feeding',
  'diaper',
  'sleep',
  'burping',
  'spit_up',
  'crying',
  'bathing',
  'medication',
  'temperature',
  'weight',
]);
export const feedingComponentType = pgEnum('feeding_component_type', [
  'direct_breastfeeding',
  'bottle',
]);
export const bottleLiquidType = pgEnum('bottle_liquid_type', [
  'expressed_breast_milk',
  'formula',
]);
export const diaperKind = pgEnum('diaper_kind', ['urine', 'stool', 'urine_stool']);
export const careActionType = pgEnum('care_action_type', [
  'burping',
  'spit_up',
  'crying',
  'bathing',
  'medication',
]);
export const spitUpAmount = pgEnum('spit_up_amount', ['small', 'medium', 'large']);
export const measurementType = pgEnum('measurement_type', ['temperature', 'weight']);
export const careRevisionAction = pgEnum('care_revision_action', ['edit', 'void']);

export const families = pgTable(
  'families',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    status: familyStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('families_single_active_idx')
      .on(sql`(1)`)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    loginName: text('login_name').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: userStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_login_name_idx').on(table.loginName)],
);

export const familyMemberships = pgTable(
  'family_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    relationship: relationship('relationship').notNull(),
    permissionLevel: permissionLevel('permission_level').notNull(),
    status: membershipStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('family_memberships_family_user_idx').on(table.familyId, table.userId),
    uniqueIndex('family_memberships_identity_owner_idx').on(table.familyId, table.id, table.userId),
    uniqueIndex('family_memberships_one_active_relationship_idx')
      .on(table.familyId, table.relationship)
      .where(sql`${table.status} = 'active'`),
    index('family_memberships_family_idx').on(table.familyId),
  ],
);

export const babies = pgTable(
  'babies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    birthDate: date('birth_date'),
    status: babyStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('babies_one_per_family_idx').on(table.familyId),
    uniqueIndex('babies_family_identity_idx').on(table.familyId, table.id),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_idx').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorMembershipId: uuid('actor_membership_id').references(() => familyMemberships.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    source: auditSource('source').notNull(),
    traceId: text('trace_id').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_family_idx').on(table.familyId),
    index('audit_events_occurred_at_idx').on(table.occurredAt),
  ],
);

export const careEvents = pgTable(
  'care_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    babyId: uuid('baby_id').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id'),
    source: careSource('source').notNull(),
    eventType: careEventType('event_type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    status: careEventStatus('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    clientRequestId: uuid('client_request_id'),
    note: text('note'),
    traceId: text('trace_id').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'care_events_family_baby_fk',
      columns: [table.familyId, table.babyId],
      foreignColumns: [babies.familyId, babies.id],
    }),
    foreignKey({
      name: 'care_events_actor_membership_fk',
      columns: [table.familyId, table.actorMembershipId, table.actorUserId],
      foreignColumns: [familyMemberships.familyId, familyMemberships.id, familyMemberships.userId],
    }),
    uniqueIndex('care_events_idempotency_idx')
      .on(table.familyId, table.actorUserId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    uniqueIndex('care_events_family_identity_idx').on(table.familyId, table.id),
    index('care_events_family_baby_occurred_idx').on(table.familyId, table.babyId, table.occurredAt),
    index('care_events_status_occurred_idx').on(table.status, table.occurredAt),
    check('care_events_version_positive', sql`${table.version} > 0`),
    check(
      'care_events_manual_actor_required',
      sql`${table.source}::text not in ('manual', 'voice') or (${table.actorUserId} is not null and ${table.actorMembershipId} is not null and ${table.clientRequestId} is not null)`,
    ),
  ],
);

export const feedingSessions = pgTable('feeding_sessions', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => careEvents.id, { onDelete: 'restrict' }),
});

export const feedingComponents = pgTable(
  'feeding_components',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionEventId: uuid('session_event_id')
      .notNull()
      .references(() => feedingSessions.eventId, { onDelete: 'restrict' }),
    componentType: feedingComponentType('component_type').notNull(),
    liquidType: bottleLiquidType('liquid_type'),
    amountMl: integer('amount_ml'),
    durationMinutes: integer('duration_minutes'),
    bottleCapacityMl: integer('bottle_capacity_ml'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('feeding_components_session_idx').on(table.sessionEventId, table.occurredAt),
    check(
      'feeding_components_shape_check',
      sql`(
        (${table.componentType} = 'direct_breastfeeding' and ${table.durationMinutes} > 0 and ${table.amountMl} is null and ${table.liquidType} is null and ${table.bottleCapacityMl} is null)
        or
        (${table.componentType} = 'bottle' and ${table.amountMl} > 0 and ${table.liquidType} is not null and ${table.durationMinutes} is null and (${table.bottleCapacityMl} is null or ${table.bottleCapacityMl} > 0))
      )`,
    ),
  ],
);

export const diaperEvents = pgTable('diaper_events', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => careEvents.id, { onDelete: 'restrict' }),
  kind: diaperKind('kind').notNull(),
  stoolColor: text('stool_color'),
  stoolConsistency: text('stool_consistency'),
  stoolAmount: text('stool_amount'),
});

export const sleepIntervals = pgTable(
  'sleep_intervals',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => careEvents.id, { onDelete: 'restrict' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'sleep_intervals_order_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const careActions = pgTable(
  'care_actions',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => careEvents.id, { onDelete: 'restrict' }),
    actionType: careActionType('action_type').notNull(),
    feedingSessionEventId: uuid('feeding_session_event_id').references(() => feedingSessions.eventId, {
      onDelete: 'restrict',
    }),
    spitUpAmount: spitUpAmount('spit_up_amount'),
    cryingDurationMinutes: integer('crying_duration_minutes'),
    medicationName: text('medication_name'),
    medicationDose: numeric('medication_dose', { precision: 12, scale: 3, mode: 'number' }),
    medicationDoseUnit: text('medication_dose_unit'),
  },
  (table) => [
    check(
      'care_actions_crying_duration_positive',
      sql`${table.cryingDurationMinutes} is null or ${table.cryingDurationMinutes} > 0`,
    ),
    check(
      'care_actions_medication_fields_check',
      sql`${table.actionType} <> 'medication' or (${table.medicationName} is not null and ${table.medicationDose} > 0 and ${table.medicationDoseUnit} is not null)`,
    ),
  ],
);

export const measurements = pgTable(
  'measurements',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => careEvents.id, { onDelete: 'restrict' }),
    measurementType: measurementType('measurement_type').notNull(),
    value: numeric('value', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    method: text('method'),
  },
  (table) => [check('measurements_value_positive', sql`${table.value} > 0`)],
);

export const careEventRevisions = pgTable(
  'care_event_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => careEvents.id, { onDelete: 'restrict' }),
    editActorUserId: uuid('edit_actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    editActorMembershipId: uuid('edit_actor_membership_id')
      .notNull()
      .references(() => familyMemberships.id, { onDelete: 'restrict' }),
    revisionAction: careRevisionAction('revision_action').notNull(),
    fromVersion: integer('from_version').notNull(),
    toVersion: integer('to_version').notNull(),
    beforeJson: jsonb('before_json').$type<Record<string, unknown>>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown>>(),
    traceId: text('trace_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('care_event_revisions_event_idx').on(table.eventId, table.createdAt),
    uniqueIndex('care_event_revisions_event_from_version_idx').on(table.eventId, table.fromVersion),
    check('care_event_revisions_version_positive', sql`${table.fromVersion} > 0`),
    check('care_event_revisions_version_step', sql`${table.toVersion} = ${table.fromVersion} + 1`),
  ],
);

export const careHandoffCheckpoints = pgTable(
  'care_handoff_checkpoints',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    babyId: uuid('baby_id').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id'),
    source: careSource('source').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    clientRequestId: uuid('client_request_id'),
    traceId: text('trace_id').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'care_handoff_checkpoints_family_baby_fk',
      columns: [table.familyId, table.babyId],
      foreignColumns: [babies.familyId, babies.id],
    }),
    foreignKey({
      name: 'care_handoff_checkpoints_actor_membership_fk',
      columns: [table.familyId, table.actorMembershipId, table.actorUserId],
      foreignColumns: [familyMemberships.familyId, familyMemberships.id, familyMemberships.userId],
    }),
    uniqueIndex('care_handoff_checkpoints_idempotency_idx')
      .on(table.familyId, table.actorUserId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    index('care_handoff_checkpoints_family_baby_occurred_idx').on(table.familyId, table.babyId, table.occurredAt),
    check(
      'care_handoff_checkpoints_manual_actor_required',
      sql`${table.source}::text not in ('manual', 'voice') or (${table.actorUserId} is not null and ${table.actorMembershipId} is not null and ${table.clientRequestId} is not null)`,
    ),
  ],
);

export const careHandoffReminderRules = pgTable(
  'care_handoff_reminder_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    babyId: uuid('baby_id').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    localTime: text('local_time').notNull(),
    weekdayMask: integer('weekday_mask').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'care_handoff_reminder_rules_family_baby_fk',
      columns: [table.familyId, table.babyId],
      foreignColumns: [babies.familyId, babies.id],
    }),
    foreignKey({
      name: 'care_handoff_reminder_rules_actor_membership_fk',
      columns: [table.familyId, table.actorMembershipId, table.actorUserId],
      foreignColumns: [familyMemberships.familyId, familyMemberships.id, familyMemberships.userId],
    }),
    index('care_handoff_reminder_rules_owner_idx').on(table.familyId, table.babyId, table.actorMembershipId),
    check('care_handoff_reminder_rules_weekday_mask_valid', sql`${table.weekdayMask} between 1 and 127`),
    check(
      'care_handoff_reminder_rules_local_time_valid',
      sql`${table.localTime} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const voiceCareDevices = pgTable(
  'voice_care_devices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    publicKey: bytea('public_key').notNull(),
    capability: text('capability').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('voice_care_devices_family_identity_idx').on(table.familyId, table.id),
    uniqueIndex('voice_care_devices_public_key_idx').on(table.publicKey),
    index('voice_care_devices_family_status_idx').on(table.familyId, table.status),
    check('voice_care_devices_public_key_length', sql`octet_length(${table.publicKey}) = 32`),
    check('voice_care_devices_capability_fixed', sql`${table.capability} = 'voice_care.intent.submit'`),
    check('voice_care_devices_status_closed', sql`${table.status} in ('active', 'revoked')`),
    check(
      'voice_care_devices_status_shape',
      sql`(${table.status} = 'active' and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null)`,
    ),
  ],
);

export const voiceCarePairingChallenges = pgTable(
  'voice_care_pairing_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    challengeDigest: bytea('challenge_digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedByDeviceId: uuid('consumed_by_device_id'),
  },
  (table) => [
    foreignKey({
      name: 'voice_care_pairing_challenges_creator_membership_fk',
      columns: [table.familyId, table.createdByMembershipId, table.createdByUserId],
      foreignColumns: [familyMemberships.familyId, familyMemberships.id, familyMemberships.userId],
    }),
    foreignKey({
      name: 'voice_care_pairing_challenges_family_device_fk',
      columns: [table.familyId, table.consumedByDeviceId],
      foreignColumns: [voiceCareDevices.familyId, voiceCareDevices.id],
    }),
    uniqueIndex('voice_care_pairing_challenges_digest_idx').on(table.challengeDigest),
    index('voice_care_pairing_challenges_family_expires_idx').on(table.familyId, table.expiresAt),
    check('voice_care_pairing_challenges_digest_length', sql`octet_length(${table.challengeDigest}) = 32`),
    check(
      'voice_care_pairing_challenges_expiry_bound',
      sql`${table.expiresAt} > ${table.createdAt} and ${table.expiresAt} <= ${table.createdAt} + interval '5 minutes'`,
    ),
    check(
      'voice_care_pairing_challenges_consumption_shape',
      sql`(${table.consumedAt} is null and ${table.consumedByDeviceId} is null) or (${table.consumedAt} between ${table.createdAt} and ${table.expiresAt} and ${table.consumedByDeviceId} is not null)`,
    ),
  ],
);

export const voiceCareLeases = pgTable(
  'voice_care_leases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    babyId: uuid('baby_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    clientRequestId: uuid('client_request_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'voice_care_leases_family_baby_fk',
      columns: [table.familyId, table.babyId],
      foreignColumns: [babies.familyId, babies.id],
    }),
    foreignKey({
      name: 'voice_care_leases_family_device_fk',
      columns: [table.familyId, table.deviceId],
      foreignColumns: [voiceCareDevices.familyId, voiceCareDevices.id],
    }),
    foreignKey({
      name: 'voice_care_leases_actor_membership_fk',
      columns: [table.familyId, table.actorMembershipId, table.actorUserId],
      foreignColumns: [familyMemberships.familyId, familyMemberships.id, familyMemberships.userId],
    }),
    uniqueIndex('voice_care_leases_family_identity_idx').on(table.familyId, table.id),
    uniqueIndex('voice_care_leases_session_owner_idx').on(
      table.familyId,
      table.id,
      table.deviceId,
      table.babyId,
      table.actorMembershipId,
      table.actorUserId,
    ),
    uniqueIndex('voice_care_leases_idempotency_idx').on(
      table.familyId,
      table.actorUserId,
      table.clientRequestId,
    ),
    uniqueIndex('voice_care_leases_one_active_device_idx')
      .on(table.familyId, table.deviceId)
      .where(sql`${table.revokedAt} is null`),
    check(
      'voice_care_leases_expiry_bound',
      sql`${table.expiresAt} > ${table.issuedAt} and ${table.expiresAt} <= ${table.issuedAt} + interval '8 hours'`,
    ),
    check(
      'voice_care_leases_revocation_order',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.issuedAt}`,
    ),
  ],
);

export const voiceCareIntentReceipts = pgTable(
  'voice_care_intent_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id').notNull(),
    requestId: uuid('request_id').notNull(),
    requestDigest: bytea('request_digest').notNull(),
    resultJson: jsonb('result_json').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'voice_care_intent_receipts_family_device_fk',
      columns: [table.familyId, table.deviceId],
      foreignColumns: [voiceCareDevices.familyId, voiceCareDevices.id],
    }),
    uniqueIndex('voice_care_intent_receipts_device_request_idx').on(table.deviceId, table.requestId),
    index('voice_care_intent_receipts_family_received_idx').on(table.familyId, table.receivedAt),
    check('voice_care_intent_receipts_digest_length', sql`octet_length(${table.requestDigest}) = 32`),
    check('voice_care_intent_receipts_result_object', sql`jsonb_typeof(${table.resultJson}) = 'object'`),
  ],
);

export const voiceCareFeedingSessions = pgTable(
  'voice_care_feeding_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'restrict' }),
    babyId: uuid('baby_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    leaseId: uuid('lease_id').notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    startRequestId: uuid('start_request_id').notNull(),
    source: text('source').notNull().default('voice'),
    state: text('state').notNull(),
    proposalJson: jsonb('proposal_json').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(1),
    proposalDigest: bytea('proposal_digest'),
    warningDigest: bytea('warning_digest'),
    warningCodesJson: jsonb('warning_codes_json').$type<string[]>().notNull().default([]),
    finalCareEventId: uuid('final_care_event_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'voice_care_feeding_sessions_family_baby_fk',
      columns: [table.familyId, table.babyId],
      foreignColumns: [babies.familyId, babies.id],
    }),
    foreignKey({
      name: 'voice_care_feeding_sessions_lease_owner_fk',
      columns: [
        table.familyId,
        table.leaseId,
        table.deviceId,
        table.babyId,
        table.actorMembershipId,
        table.actorUserId,
      ],
      foreignColumns: [
        voiceCareLeases.familyId,
        voiceCareLeases.id,
        voiceCareLeases.deviceId,
        voiceCareLeases.babyId,
        voiceCareLeases.actorMembershipId,
        voiceCareLeases.actorUserId,
      ],
    }),
    foreignKey({
      name: 'voice_care_feeding_sessions_final_event_fk',
      columns: [table.familyId, table.finalCareEventId],
      foreignColumns: [careEvents.familyId, careEvents.id],
    }),
    uniqueIndex('voice_care_feeding_sessions_device_request_idx').on(table.deviceId, table.startRequestId),
    uniqueIndex('voice_care_feeding_sessions_final_event_idx')
      .on(table.finalCareEventId)
      .where(sql`${table.finalCareEventId} is not null`),
    index('voice_care_feeding_sessions_family_baby_state_idx').on(table.familyId, table.babyId, table.state),
    check('voice_care_feeding_sessions_source_fixed', sql`${table.source} = 'voice'`),
    check('voice_care_feeding_sessions_state_closed', sql`${table.state} in ('pending', 'needs_confirmation', 'needs_review', 'cancelled', 'committing', 'committed')`),
    check('voice_care_feeding_sessions_version_positive', sql`${table.version} > 0`),
    check('voice_care_feeding_sessions_proposal_object', sql`jsonb_typeof(${table.proposalJson}) = 'object'`),
    check('voice_care_feeding_sessions_warning_codes_array', sql`jsonb_typeof(${table.warningCodesJson}) = 'array'`),
    check('voice_care_feeding_sessions_proposal_digest_length', sql`${table.proposalDigest} is null or octet_length(${table.proposalDigest}) = 32`),
    check('voice_care_feeding_sessions_warning_digest_length', sql`${table.warningDigest} is null or octet_length(${table.warningDigest}) = 32`),
    check(
      'voice_care_feeding_sessions_warning_shape',
      sql`(${table.warningDigest} is null) = (${table.warningCodesJson} = '[]'::jsonb)`,
    ),
    check(
      'voice_care_feeding_sessions_expiry_bound',
      sql`${table.expiresAt} > ${table.startedAt} and ${table.expiresAt} <= ${table.startedAt} + interval '6 hours'`,
    ),
    check(
      'voice_care_feeding_sessions_timestamp_order',
      sql`(${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}) and (${table.confirmedAt} is null or (${table.endedAt} is not null and ${table.confirmedAt} >= ${table.endedAt})) and (${table.cancelledAt} is null or ${table.cancelledAt} >= ${table.startedAt})`,
    ),
    check(
      'voice_care_feeding_sessions_state_shape',
      sql`(
        (${table.state} = 'pending' and ${table.proposalDigest} is null and ${table.finalCareEventId} is null and ${table.endedAt} is null and ${table.confirmedAt} is null and ${table.cancelledAt} is null)
        or (${table.state} = 'needs_confirmation' and ${table.proposalDigest} is not null and ${table.finalCareEventId} is null and ${table.endedAt} is not null and ${table.confirmedAt} is null and ${table.cancelledAt} is null)
        or (${table.state} = 'needs_review' and ${table.finalCareEventId} is null and ${table.confirmedAt} is null and ${table.cancelledAt} is null)
        or (${table.state} = 'cancelled' and ${table.finalCareEventId} is null and ${table.confirmedAt} is null and ${table.cancelledAt} is not null)
        or (${table.state} = 'committing' and ${table.proposalDigest} is not null and ${table.finalCareEventId} is null and ${table.endedAt} is not null and ${table.confirmedAt} is null and ${table.cancelledAt} is null)
        or (${table.state} = 'committed' and ${table.proposalDigest} is not null and ${table.finalCareEventId} is not null and ${table.endedAt} is not null and ${table.confirmedAt} is not null and ${table.cancelledAt} is null)
      )`,
    ),
  ],
);
