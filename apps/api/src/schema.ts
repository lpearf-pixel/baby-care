import { sql } from 'drizzle-orm';
import {
  check,
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

export const careSource = pgEnum('care_source', ['manual', 'guardian', 'device', 'import', 'ai']);
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
    index('care_events_family_baby_occurred_idx').on(table.familyId, table.babyId, table.occurredAt),
    index('care_events_status_occurred_idx').on(table.status, table.occurredAt),
    check('care_events_version_positive', sql`${table.version} > 0`),
    check(
      'care_events_manual_actor_required',
      sql`${table.source} <> 'manual' or (${table.actorUserId} is not null and ${table.actorMembershipId} is not null and ${table.clientRequestId} is not null)`,
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
    beforeJson: jsonb('before_json').$type<Record<string, unknown>>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown>>(),
    traceId: text('trace_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('care_event_revisions_event_idx').on(table.eventId, table.createdAt)],
);
