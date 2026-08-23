import { z } from 'zod';
import { CareEventStatusSchema, CareSourceSchema } from './care/common.js';
import {
  BathingTimelinePayloadSchema,
  BurpingTimelinePayloadSchema,
  CryingTimelinePayloadSchema,
  DiaperTimelinePayloadSchema,
  FeedingTimelinePayloadSchema,
  MedicationTimelinePayloadSchema,
  SleepTimelinePayloadSchema,
  SpitUpTimelinePayloadSchema,
  TemperatureTimelinePayloadSchema,
  WeightTimelinePayloadSchema,
} from './care/query.js';
import { EditCareEventInputSchema } from './care/revisions.js';

export const FAMILY_EXPORT_SCHEMA_VERSION = 1;
export const DEFAULT_FAMILY_EXPORT_MAX_BYTES = 33_554_432;

const OffsetDateTimeSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();

const ExportFamilySchema = z.object({
  id: UuidSchema,
  name: z.string(),
  timezone: z.string().min(1),
  status: z.literal('active'),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
}).strict();

const ExportBabySchema = z.object({
  id: UuidSchema,
  familyId: UuidSchema,
  displayName: z.string(),
  birthDate: z.string().date().nullable(),
  status: z.literal('active'),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
}).strict();

const ExportMemberSchema = z.object({
  membershipId: UuidSchema,
  familyId: UuidSchema,
  userId: UuidSchema,
  displayName: z.string(),
  relationship: z.enum(['dad', 'mom', 'nanny']),
  permissionLevel: z.enum(['family_admin', 'caregiver']),
  status: z.enum(['active', 'disabled']),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
}).strict();

const ExportCareEventBaseSchema = z.object({
  id: UuidSchema,
  familyId: UuidSchema,
  babyId: UuidSchema,
  actorUserId: UuidSchema.nullable(),
  actorMembershipId: UuidSchema.nullable(),
  actorDisplayName: z.string().nullable(),
  source: CareSourceSchema,
  occurredAt: OffsetDateTimeSchema,
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
  status: CareEventStatusSchema,
  version: z.number().int().positive(),
  note: z.string().nullable(),
});

const ExportCareEventSchema = z.discriminatedUnion('eventType', [
  ExportCareEventBaseSchema.extend({ eventType: z.literal('feeding'), payload: FeedingTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('diaper'), payload: DiaperTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('sleep'), payload: SleepTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('burping'), payload: BurpingTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('spit_up'), payload: SpitUpTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('crying'), payload: CryingTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('bathing'), payload: BathingTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('medication'), payload: MedicationTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('temperature'), payload: TemperatureTimelinePayloadSchema }).strict(),
  ExportCareEventBaseSchema.extend({ eventType: z.literal('weight'), payload: WeightTimelinePayloadSchema }).strict(),
]);

const ExportCareRevisionSnapshotSchema = z.union([
  EditCareEventInputSchema,
  z.object({ status: z.literal('active') }).strict(),
  z.object({ status: z.literal('voided') }).strict(),
]);

const ExportCareRevisionSchema = z.object({
  id: UuidSchema,
  eventId: UuidSchema,
  actorUserId: UuidSchema,
  actorMembershipId: UuidSchema,
  actorDisplayName: z.string(),
  action: z.enum(['edit', 'void']),
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  before: ExportCareRevisionSnapshotSchema,
  after: ExportCareRevisionSnapshotSchema,
  createdAt: OffsetDateTimeSchema,
}).strict().superRefine((value, context) => {
  if (value.toVersion !== value.fromVersion + 1) {
    context.addIssue({ code: 'custom', path: ['toVersion'], message: 'Revision versions must advance by one.' });
  }
});

const ExportHandoffCheckpointSchema = z.object({
  id: UuidSchema,
  familyId: UuidSchema,
  babyId: UuidSchema,
  actorUserId: UuidSchema.nullable(),
  actorMembershipId: UuidSchema.nullable(),
  actorDisplayName: z.string().nullable(),
  source: CareSourceSchema,
  occurredAt: OffsetDateTimeSchema,
  createdAt: OffsetDateTimeSchema,
}).strict();

const ExportHandoffReminderRuleSchema = z.object({
  id: UuidSchema,
  familyId: UuidSchema,
  babyId: UuidSchema,
  actorUserId: UuidSchema,
  actorMembershipId: UuidSchema,
  actorDisplayName: z.string(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected local time in HH:mm format.'),
  weekdayMask: z.number().int().min(1).max(127),
  enabled: z.boolean(),
  createdAt: OffsetDateTimeSchema,
  updatedAt: OffsetDateTimeSchema,
}).strict();

const FamilyExportSchemaV1Implementation = z.object({
  schemaVersion: z.literal(FAMILY_EXPORT_SCHEMA_VERSION),
  generatedAt: OffsetDateTimeSchema,
  family: ExportFamilySchema,
  baby: ExportBabySchema,
  members: z.array(ExportMemberSchema),
  careEvents: z.array(ExportCareEventSchema),
  careRevisions: z.array(ExportCareRevisionSchema),
  handoffCheckpoints: z.array(ExportHandoffCheckpointSchema),
  handoffReminderRules: z.array(ExportHandoffReminderRuleSchema),
}).strict();

export type FamilyExportV1 = z.infer<typeof FamilyExportSchemaV1Implementation>;
export type FamilyExportMember = z.infer<typeof ExportMemberSchema>;
export type FamilyExportCareEvent = z.infer<typeof ExportCareEventSchema>;
export type FamilyExportCareRevision = z.infer<typeof ExportCareRevisionSchema>;
export type FamilyExportHandoffCheckpoint = z.infer<typeof ExportHandoffCheckpointSchema>;
export type FamilyExportHandoffReminderRule = z.infer<typeof ExportHandoffReminderRuleSchema>;

export const FamilyExportSchemaV1: z.ZodType<FamilyExportV1> = FamilyExportSchemaV1Implementation;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTime(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

export function compareFamilyExportMembers(left: FamilyExportMember, right: FamilyExportMember): number {
  return compareText(left.relationship, right.relationship)
    || compareText(left.membershipId, right.membershipId);
}

export function compareFamilyExportCareEvents(left: FamilyExportCareEvent, right: FamilyExportCareEvent): number {
  return compareTime(left.occurredAt, right.occurredAt)
    || compareTime(left.createdAt, right.createdAt)
    || compareText(left.id, right.id);
}

export function compareFamilyExportCareRevisions(left: FamilyExportCareRevision, right: FamilyExportCareRevision): number {
  return compareText(left.eventId, right.eventId)
    || left.fromVersion - right.fromVersion
    || compareText(left.id, right.id);
}

export function compareFamilyExportHandoffCheckpoints(
  left: FamilyExportHandoffCheckpoint,
  right: FamilyExportHandoffCheckpoint,
): number {
  return compareTime(left.occurredAt, right.occurredAt)
    || compareTime(left.createdAt, right.createdAt)
    || compareText(left.id, right.id);
}

export function compareFamilyExportHandoffReminderRules(
  left: FamilyExportHandoffReminderRule,
  right: FamilyExportHandoffReminderRule,
): number {
  return compareText(left.actorMembershipId, right.actorMembershipId)
    || compareText(left.localTime, right.localTime)
    || left.weekdayMask - right.weekdayMask
    || compareText(left.id, right.id);
}

export function familyExportFilename(generatedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `baby-care-export-${generatedAt.getUTCFullYear()}${pad(generatedAt.getUTCMonth() + 1)}${pad(generatedAt.getUTCDate())}`
    + `T${pad(generatedAt.getUTCHours())}${pad(generatedAt.getUTCMinutes())}${pad(generatedAt.getUTCSeconds())}Z.json`;
}
