import { z } from 'zod';

const traceId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const DiagnosticEventSchema = z
  .object({
    schema_version: z.literal(1),
    timestamp: z.string().datetime(),
    trace_id: traceId,
    component: z.string().min(1).max(128),
    event_code: z.string().min(1).max(128).regex(/^[A-Z0-9_]+$/),
    severity: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().min(1).max(1024),
    expected: z.string().max(2048).optional(),
    actual: z.string().max(2048).optional(),
    error_class: z.string().max(256).optional(),
    evidence_pointer: z.string().max(1024).optional(),
  })
  .strict();

export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;

export type DiagnosticEventInput = Omit<
  DiagnosticEvent,
  'schema_version' | 'timestamp'
> & {
  timestamp?: string;
};

export function createDiagnosticEvent(
  input: DiagnosticEventInput,
): DiagnosticEvent {
  return DiagnosticEventSchema.parse({
    ...input,
    schema_version: 1,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}
