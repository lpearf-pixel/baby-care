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
      'private-formula-type',
      'private-bottle-kind',
      '61',
      '151',
      'raw-session-token-private',
      'setup-token-private',
    ];
    await writeFile(
      evidenceFile,
      [
        'request failed medicationName="Private Medication Name" dose=0.5 doseUnit=mL',
        'measurement valueCelsius=37.2 valueKg=3.4 note="private care note body"',
        'feeding components=[',
        '  {"kind":"private-bottle-kind",',
        '   "liquidType":"private-formula-type",',
        '   "amountMl":61,',
        '   "bottleCapacityMl":151}',
        ']',
        'feeding amountMl=61 bottleCapacityMl=151 liquidType="private-formula-type"',
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

  it('redacts the extended care-field matrix and whole revision snapshots', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'baby-care-diag-matrix-'));
    const evidenceFile = resolve(cwd, 'integration.log');
    const forbidden = [
      '73-private-duration',
      '74-private-duration-snake',
      'private-stool-color',
      'private-stool-consistency',
      'private-stool-amount',
      'private-measurement-method',
      'private-related-action',
      'private-before-note',
      'private-before-milk',
      'private-after-medication',
      'private-after-dose',
      'private-future-care-field',
    ];
    await writeFile(
      evidenceFile,
      [
        'durationMinutes="73-private-duration" duration_minutes="74-private-duration-snake"',
        'stoolColor="private-stool-color" stool_consistency="private-stool-consistency" stoolAmount="private-stool-amount"',
        'method="private-measurement-method"',
        'relatedActions=[{"kind":"spit_up","amount":"private-related-action"}]',
        'before_json={"note":"private-before-note","components":[{"amountMl":"private-before-milk"}]}',
        'after_json={',
        '  "action":{"kind":"medication","medicationName":"private-after-medication",',
        '  "dose":"private-after-dose"}',
        '}',
        'futureCareField="private-future-care-field"',
        'constraint care_event_owner_membership_fk failed code=care_state_conflict',
      ].join('\n'),
      'utf8',
    );

    await runCollector(cwd, evidenceFile);
    const summary = JSON.parse(
      await readFile(resolve(cwd, 'diagnostics/latest/summary.json'), 'utf8'),
    ) as { evidence: string };

    for (const secret of forbidden) expect(summary.evidence).not.toContain(secret);
    expect(summary.evidence).toContain('care_event_owner_membership_fk');
    expect(summary.evidence).toContain('care_state_conflict');
    expect(summary.evidence).toContain('[REDACTED]');
  });

  it('drops unkeyed assertion bodies while retaining only allowlisted diagnostic metadata', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'baby-care-diag-diff-'));
    const evidenceFile = resolve(cwd, 'integration.log');
    await writeFile(
      evidenceFile,
      [
        'FAIL care-event.test.ts > edit conflict',
        '- Expected',
        '- "private care note body"',
        '+ Received',
        '+ "another private body"',
        'event_id=11111111-1111-4111-8111-111111111111 event_type=feeding status=failed',
        'trace_id=trace-safe-123 duration_ms=47 code=care_state_conflict',
        'constraint care_event_owner_membership_fk failed',
      ].join('\n'),
      'utf8',
    );

    await runCollector(cwd, evidenceFile);
    const summary = JSON.parse(
      await readFile(resolve(cwd, 'diagnostics/latest/summary.json'), 'utf8'),
    ) as { evidence: string };

    expect(summary.evidence).not.toContain('private care note body');
    expect(summary.evidence).not.toContain('another private body');
    expect(summary.evidence).not.toContain('- Expected');
    expect(summary.evidence).not.toContain('+ Received');
    expect(summary.evidence).toContain('event_id=11111111-1111-4111-8111-111111111111');
    expect(summary.evidence).toContain('event_type=feeding');
    expect(summary.evidence).toContain('status=failed');
    expect(summary.evidence).toContain('trace_id=trace-safe-123');
    expect(summary.evidence).toContain('duration_ms=47');
    expect(summary.evidence).toContain('code=care_state_conflict');
    expect(summary.evidence).toContain('constraint=care_event_owner_membership_fk');
  });
});
