import { z } from 'zod';

export const DiagnosticEventSchema = z.never();
export type DiagnosticEvent = z.infer<typeof DiagnosticEventSchema>;

export function createDiagnosticEvent(): DiagnosticEvent {
  throw new Error('not implemented');
}
