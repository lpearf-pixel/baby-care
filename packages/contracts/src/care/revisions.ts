import { z } from 'zod';
import { CareActionPayloadSchema } from './actions.js';
import { FeedingComponentInputSchema, FeedingRelatedActionInputSchema } from './feeding-components.js';
import { MeasurementPayloadSchema } from './measurements.js';

const NoteSchema = z.string().trim().max(1000).optional();
const OccurredAtSchema = z.string().datetime({ offset: true });

const FeedingEditSchema = z.object({
  eventType: z.literal('feeding'),
  occurredAt: OccurredAtSchema,
  note: NoteSchema,
  components: z.array(FeedingComponentInputSchema).min(1).max(16),
  relatedActions: z.array(FeedingRelatedActionInputSchema).max(8).optional(),
}).strict();

const DiaperEditSchema = z.object({
  eventType: z.literal('diaper'),
  occurredAt: OccurredAtSchema,
  note: NoteSchema,
  kind: z.enum(['urine', 'stool', 'urine_stool']),
  stoolColor: z.string().trim().min(1).max(80).optional(),
  stoolConsistency: z.string().trim().min(1).max(80).optional(),
  stoolAmount: z.string().trim().min(1).max(80).optional(),
}).strict();

const SleepEditSchema = z.object({
  eventType: z.literal('sleep'),
  startedAt: OccurredAtSchema,
  endedAt: OccurredAtSchema.nullable().optional(),
  note: NoteSchema,
}).strict().superRefine((value, context) => {
  if (value.endedAt && new Date(value.endedAt).getTime() < new Date(value.startedAt).getTime()) {
    context.addIssue({ code: 'custom', path: ['endedAt'], message: 'Sleep end must not be before start.' });
  }
});

const ActionEditSchema = z.object({
  eventType: z.enum(['burping', 'spit_up', 'crying', 'bathing', 'medication']),
  occurredAt: OccurredAtSchema,
  note: NoteSchema,
  action: CareActionPayloadSchema,
}).strict().superRefine((value, context) => {
  if (value.eventType !== value.action.kind) {
    context.addIssue({ code: 'custom', path: ['action', 'kind'], message: 'Action kind must match event type.' });
  }
});

const MeasurementEditSchema = z.object({
  eventType: z.enum(['temperature', 'weight']),
  occurredAt: OccurredAtSchema,
  note: NoteSchema,
  measurement: MeasurementPayloadSchema,
}).strict().superRefine((value, context) => {
  if (value.eventType !== value.measurement.kind) {
    context.addIssue({ code: 'custom', path: ['measurement', 'kind'], message: 'Measurement kind must match event type.' });
  }
});

export const EditCareEventInputSchema = z.union([
  FeedingEditSchema,
  DiaperEditSchema,
  SleepEditSchema,
  ActionEditSchema,
  MeasurementEditSchema,
]);

export const CareRevisionReceiptSchema = z.object({
  id: z.string().uuid(),
  eventType: z.enum(['feeding', 'diaper', 'sleep', 'burping', 'spit_up', 'crying', 'bathing', 'medication', 'temperature', 'weight']),
  status: z.enum(['active', 'voided']),
  version: z.number().int().positive(),
}).strict();

export const UndoCareEventResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal('voided'),
}).strict();

export type EditCareEventInput = z.infer<typeof EditCareEventInputSchema>;
export type CareRevisionReceipt = z.infer<typeof CareRevisionReceiptSchema>;
export type UndoCareEventResponse = z.infer<typeof UndoCareEventResponseSchema>;
