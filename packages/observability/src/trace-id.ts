import { randomUUID } from 'node:crypto';

const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isValidTraceId(candidate: string): boolean {
  return TRACE_ID_PATTERN.test(candidate);
}

export function resolveTraceId(candidate?: string): string {
  if (candidate !== undefined && isValidTraceId(candidate)) {
    return candidate;
  }
  return randomUUID();
}
