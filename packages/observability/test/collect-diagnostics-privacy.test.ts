import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const collector = resolve(repoRoot, 'scripts/collect-diagnostics.mjs');

function runCollector(cwd: string, evidenceFile: string): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [collector], {
      cwd,
      env: {
        ...process.env,
        DIAG_STAGE: 'integration',
        DIAG_COMPONENT: 'api-postgres',
        DIAG_EVENT_CODE: 'INTEGRATION_GATE_FAILED',
        DIAG_EVIDENCE_FILE: evidenceFile,
      },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`collector exited ${code}`));
    });
  });
}

describe('compact diagnostic privacy', () => {
  it('redacts care payload values and auth/setup secrets from bounded evidence', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'baby-care-diag-'));
    const evidenceFile = resolve(cwd, 'integration.log');
    const forbidden = [
      'Private Medication Name',
      '0.5',
      '37.2',
      '3.4',
      'private care note body',
      'raw-session-token-private',
      'setup-token-private',
    ];
    await writeFile(
      evidenceFile,
      [
        'request failed medicationName="Private Medication Name" dose=0.5 doseUnit=mL',
        'measurement valueCelsius=37.2 valueKg=3.4 note="private care note body"',
        'cookie="baby_care_session=raw-session-token-private" setupToken="setup-token-private"',
        'constraint care_event_owner_membership_fk failed',
      ].join('\n'),
      'utf8',
    );

    await runCollector(cwd, evidenceFile);
    const summary = JSON.parse(
      await readFile(resolve(cwd, 'diagnostics/latest/summary.json'), 'utf8'),
    ) as unknown;

    expect(summary).toEqual(expect.objectContaining({ evidence: expect.any(String) }));
    const evidence = (summary as { evidence: string }).evidence;

    for (const secret of forbidden) expect(evidence).not.toContain(secret);
    expect(evidence).toContain('care_event_owner_membership_fk');
    expect(evidence).toContain('[REDACTED]');
  });
});
