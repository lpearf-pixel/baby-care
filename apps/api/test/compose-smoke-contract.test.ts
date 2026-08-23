import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production Compose smoke contract', () => {
  it('explicitly confirms the deliberate duplicate M3 Nanny diaper fact', () => {
    const source = readFileSync(new URL('../../../scripts/compose-smoke.mjs', import.meta.url), 'utf8');
    const requestStart = source.indexOf('const m3NannyDiaper =');
    const requestEnd = source.indexOf('const m3NannyDiaperId', requestStart);

    expect(requestStart).toBeGreaterThan(-1);
    expect(requestEnd).toBeGreaterThan(requestStart);
    expect(source.slice(requestStart, requestEnd)).toContain("confirmedWarnings: ['possible_duplicate']");
  });
});
