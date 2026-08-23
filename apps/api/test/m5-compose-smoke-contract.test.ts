import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const scriptUrl = new URL('../../../scripts/m5-voice-care-feeding-pilot.mjs', import.meta.url);
const workflowUrl = new URL('../../../.github/workflows/ci.yml', import.meta.url);
const composeUrl = new URL('../../../compose.yaml', import.meta.url);

function source(): string {
  return readFileSync(scriptUrl, 'utf8');
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe('M5 Voice Care feeding pilot production contract', () => {
  it('emits every fixed M5 marker exactly once and in order', () => {
    const script = source();
    const markers = [
      'SMOKE_OK component=m5-device-lease',
      'SMOKE_OK component=m5-feeding-confirm',
      'SMOKE_OK component=m5-recovery',
      'SMOKE_OK component=m5-voice-care-feeding-pilot',
    ];
    let previous = -1;
    for (const marker of markers) {
      expect(occurrences(script, marker)).toBe(1);
      expect(script.indexOf(marker)).toBeGreaterThan(previous);
      previous = script.indexOf(marker);
    }
  });

  it('uses generated Ed25519 authority and the exact Voice Care surface', () => {
    const script = source();
    for (const required of [
      "generateKeyPairSync('ed25519')",
      'voiceCarePairingSigningBytesV1',
      'voiceCareSigningBytesV1',
      '/api/voice-care/pairing-challenges',
      '/api/voice-care/devices',
      '/api/voice-care/intents',
      '/api/voice-care/state',
      '/api/care/actions',
      '/api/family/export',
      'backup:create',
      'backup:verify',
      'backup:restore',
    ]) expect(script, `missing ${required}`).toContain(required);
    expect(script).toContain('const dadPassword = randomUUID()');
    expect(script).toContain('const momPassword = randomUUID()');
    expect(script).toContain('const nannyPassword = randomUUID()');
    expect(script).not.toMatch(/m5-(?:dad|mom|nanny)-generated-password/);
  });

  it('proves confirm idempotency, cancellation, revocation and manual Nanny fallback', () => {
    const script = source();
    for (const required of [
      'duplicateConfirmation',
      'cancelledSession',
      'revokedIntent',
      'nannyFallback',
      'FamilyExportSchemaV2',
      'revokedVoiceCareLeaseCount',
      'invalidatedVoiceCareSessionCount',
    ]) expect(script, `missing ${required}`).toContain(required);
  });

  it('keeps Voice Care default-disabled and enables it only for the M5 CI stack', () => {
    const compose = readFileSync(composeUrl, 'utf8');
    const workflow = readFileSync(workflowUrl, 'utf8');
    expect(compose).toContain('VOICE_CARE_ENABLED: "${VOICE_CARE_ENABLED:-false}"');
    expect(compose).toContain('BABY_CARE_SETUP_TOKEN: "${BABY_CARE_SETUP_TOKEN:-local-development-setup-token-change-me}"');
    expect(source()).toContain('const SETUP_TOKEN = randomUUID()');
    expect(source()).toContain('BABY_CARE_SETUP_TOKEN: SETUP_TOKEN');
    expect(source()).not.toContain("const SETUP_TOKEN = 'local-development-setup-token-change-me'");
    expect(workflow).toContain('VOICE_CARE_ENABLED: "true"');
    expect(workflow).toContain('scripts/compose-smoke.mjs');
    expect(workflow).toContain('scripts/m4-birth-ready-operations.mjs');
    expect(workflow).toContain('scripts/m5-voice-care-feeding-pilot.mjs');
  });

  it('never writes semantic values or security material to output', () => {
    const outputStatements = source().match(
      /(?:console\.(?:log|error)|process\.(?:stdout|stderr)\.write)\([^\n]*\)/g,
    ) ?? [];
    expect(outputStatements.length).toBeGreaterThan(0);
    for (const statement of outputStatements) {
      expect(statement).not.toMatch(
        /amountMl|displayName|proposal|publicKey|privateKey|signature|challenge|cookie|password|path|payload|response|digest/i,
      );
    }
  });

  it('uses bounded subprocess output and owns cleanup before teardown', () => {
    const script = source();
    expect(script).toContain('MAX_CHILD_OUTPUT_BYTES');
    expect(script).toContain('PROCESS_TIMEOUT_MS');
    expect(script).toContain('await realpath(tmpdir())');
    expect(script).toContain('safePrivateTempRoot');
    expect(script).toContain('sourceOwned = true');
    expect(script.indexOf('sourceOwned = true')).toBeLessThan(script.indexOf("'down'"));
    expect(script).toContain("'--remove-orphans'");
    expect(script).toContain("'--volumes'");
  });

  it('maps child stderr through a fixed failure-code allowlist', () => {
    const script = source();
    expect(script).toContain('ALLOWED_CHILD_FAILURE_CODES');
    expect(script).toContain("ALLOWED_CHILD_FAILURE_CODES.has(candidate) ? candidate : 'unknown'");
    expect(script).not.toContain('/^[a-z0-9_]{1,64}$/');
  });
});
