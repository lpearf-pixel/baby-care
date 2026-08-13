export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEventInput {
  level: DiagnosticLevel;
  eventCode: string;
  component: string;
  message: string;
  traceId?: string;
  expected?: string;
  actual?: string;
  evidencePointer?: string;
}

export interface DiagnosticEvent {
  timestamp: string;
  level: DiagnosticLevel;
  event_code: string;
  component: string;
  message: string;
  trace_id?: string;
  expected?: string;
  actual?: string;
  evidence_pointer?: string;
}

const SECRET_PATTERNS = [
  /authorization\s*:/i,
  /bearer\s+[a-z0-9._~+\/-]+/i,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/i,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[=:]/i,
];

function redact(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return SECRET_PATTERNS.some((pattern) => pattern.test(value)) ? '[REDACTED]' : value;
}

export function createDiagnosticEvent(input: DiagnosticEventInput): DiagnosticEvent {
  const event: DiagnosticEvent = {
    timestamp: new Date().toISOString(),
    level: input.level,
    event_code: input.eventCode,
    component: input.component,
    message: input.message,
  };
  if (input.traceId) event.trace_id = input.traceId;
  if (input.expected) event.expected = redact(input.expected);
  if (input.actual) event.actual = redact(input.actual);
  if (input.evidencePointer) event.evidence_pointer = redact(input.evidencePointer);
  return event;
}
