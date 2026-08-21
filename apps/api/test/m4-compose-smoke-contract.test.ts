import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scriptUrl = new URL('../../../scripts/m4-birth-ready-operations.mjs', import.meta.url);

function source(): string {
  return readFileSync(scriptUrl, 'utf8');
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function childFailureCall(stderr: string): string {
  const childProgram = `process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = 1;`;
  return `await runChild(process.execPath, ['-e', ${JSON.stringify(childProgram)}]);`;
}

function injectChildStderr(...stderrValues: string[]) {
  const injectedCalls = stderrValues.map((stderr, index) => (
    index === stderrValues.length - 1
      ? `  ${childFailureCall(stderr)}`
      : `  try { ${childFailureCall(stderr)} } catch {}`
  )).join('\n');
  const instrumented = source()
    .replace(
      "import { FamilyExportSchemaV1 } from '../packages/contracts/src/index.ts';",
      'const FamilyExportSchemaV1 = {};',
    )
    .replace(
      '  await main();',
      injectedCalls,
    );
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: instrumented,
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (result.error) throw result.error;
  return result;
}

describe('M4 birth-ready production Compose smoke contract', () => {
  it('emits every fixed M4 success marker exactly once and in order', () => {
    const script = source();
    const markers = [
      'SMOKE_OK component=m4-family-export',
      'SMOKE_OK component=m4-backup-integrity',
      'SMOKE_OK component=m4-isolated-restore',
      'SMOKE_OK component=m4-birth-ready-operations',
    ];

    let previous = -1;
    for (const marker of markers) {
      expect(occurrences(script, marker)).toBe(1);
      const index = script.indexOf(marker);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it('exercises the complete M4 care, handoff, export, backup, and restore surface', () => {
    const script = source();
    const requiredLiterals = [
      '/api/setup',
      '/api/auth/login',
      '/api/auth/session',
      '/api/family/members',
      '/api/care/feeding-sessions',
      '/api/care/diapers',
      '/api/care/sleep/start',
      '/api/care/sleep/wake',
      '/api/care/actions',
      '/api/care/measurements',
      '/api/care/handoffs',
      '/api/care/handoff-reminders',
      '/api/care/summary',
      '/api/care/timeline',
      '/revisions',
      '/undo',
      '/api/family/export',
      'backup:create',
      'backup:verify',
      'backup:restore',
      'postgres_restore',
      'operations_verifier',
      "kind: 'burping'",
      "kind: 'spit_up'",
      "kind: 'bathing'",
      "kind: 'medication'",
      "kind: 'temperature'",
      "kind: 'weight'",
    ];

    for (const literal of requiredLiterals) {
      expect(script, `missing ${literal}`).toContain(literal);
    }
  });

  it('validates both administrator exports and the required authorization lifecycle', () => {
    const script = source();

    expect(script).toContain('FamilyExportSchemaV1');
    expect(script).toMatch(/const dadExport\s*=\s*await request\('\/api\/family\/export'/);
    expect(script).toMatch(/const momExport\s*=\s*await request\('\/api\/family\/export'/);
    expect(script).toMatch(/const nannyExportDenied\s*=\s*await request\('\/api\/family\/export',[\s\S]*?expectedStatus:\s*403/);
    expect(script).toMatch(/const oldCookieDenied\s*=\s*await (?:request|inject)\([^\n]*'\/api\/auth\/session',[\s\S]*?expectedStatus:\s*401/);
    expect(script).toMatch(/const freshDadLogin\s*=\s*await (?:request|inject)\([^\n]*'\/api\/auth\/login'/);
  });

  it('compares only stable typed restored facts', () => {
    const script = source();
    const stableFields = [
      'timelineDigest',
      'summaryDigest',
      'revisionDigest',
      'handoffDigest',
      'actorDigest',
      'statusDigest',
      'eventCount',
      'revisionCount',
      'checkpointCount',
      'maxVersion',
    ];

    expect(script).toContain('STABLE_COMPARISON_KEYS');
    for (const field of stableFields) {
      expect(script, `missing stable comparison field ${field}`).toContain(`'${field}'`);
    }
    expect(script).toContain('assertStableFactsEqual');
  });

  it('does not log response bodies, credentials, paths, manifests, dumps, or care fixture values', () => {
    const script = source();
    const outputStatements = script.match(/(?:console\.(?:log|error)|process\.(?:stdout|stderr)\.write)\([^\n]*\)/g) ?? [];
    const forbidden = /response|payload|body|export|dump|manifest|cookie|password|path|bundle|amount|dose|weight|temperature|medication/i;

    expect(outputStatements.length).toBeGreaterThan(0);
    for (const statement of outputStatements) {
      expect(statement).not.toMatch(forbidden);
    }
  });

  it('proves exclusive restore-project ownership before any cleanup is armed', () => {
    const script = source();
    const ownershipIndex = script.indexOf('targetOwned = true');

    expect(script).toContain("'volume', 'ls'");
    expect(script).toContain("'network', 'ls'");
    expect(script.indexOf("'volume', 'ls'")).toBeLessThan(ownershipIndex);
    expect(script.indexOf("'network', 'ls'")).toBeLessThan(ownershipIndex);
  });

  it.each(['password', 'secret_token', 'formula'])(
    'maps unknown or sensitive raw child stderr to the closed unknown code',
    (rawStderr) => {
      const result = injectChildStderr(rawStderr);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('M4_SMOKE_FAILED stage=bootstrap code=unknown\n');
      expect(result.stderr).not.toContain(rawStderr);
    },
  );

  it('preserves only an explicitly allow-listed child failure code', () => {
    const result = injectChildStderr('backup_integrity_failed');

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('M4_SMOKE_FAILED stage=bootstrap code=backup_integrity_failed\n');
  });

  it('forgets a previous allow-listed code when a later child emits unknown stderr', () => {
    const result = injectChildStderr('backup_integrity_failed', 'secret_token');

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('M4_SMOKE_FAILED stage=bootstrap code=unknown\n');
    expect(result.stderr).not.toContain('secret_token');
  });
});
