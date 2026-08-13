import { sql } from 'drizzle-orm';
import {
  date,
  index,
  jsonb,
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
  (table) => [uniqueIndex('babies_one_per_family_idx').on(table.familyId)],
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
