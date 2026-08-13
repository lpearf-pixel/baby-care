export interface DiagnosticSummaryInput {
  status: 'failure';
  stage: string;
  component: string;
  event_code: string;
  evidence: string;
}

export interface DiagnosticSummary extends DiagnosticSummaryInput {
  schema_version: 1;
  generated_at: string;
}

export function truncateEvidence(value: string, maximum = 2048): string {
  if (maximum < 16) {
    throw new RangeError('maximum must be at least 16');
  }
  if (value.length <= maximum) {
    return value;
  }
  const marker = '\n[truncated]';
  return `${value.slice(0, maximum - marker.length)}${marker}`;
}

export function buildDiagnosticSummary(
  input: DiagnosticSummaryInput,
): DiagnosticSummary {
  return {
    schema_version: 1,
    status: input.status,
    stage: input.stage,
    component: input.component,
    event_code: input.event_code,
    evidence: truncateEvidence(input.evidence),
    generated_at: new Date().toISOString(),
  };
}
