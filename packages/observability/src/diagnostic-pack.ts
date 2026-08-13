export interface DiagnosticSummaryInput {
  status: 'failure';
  stage: string;
  component: string;
  event_code: string;
  evidence: string;
}

export function truncateEvidence(_value: string, _maximum = 2048): string {
  return '';
}

export function buildDiagnosticSummary(_input: DiagnosticSummaryInput) {
  return {
    schema_version: 1 as const,
    status: 'failure' as const,
    stage: '',
    component: '',
    event_code: '',
    evidence: '',
    generated_at: '',
  };
}
