import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FamilyExportSchemaV2,
  VoiceCareIntentV1Schema,
  VoiceCareSemanticResultV1Schema,
  voiceCarePairingSigningBytesV1,
  voiceCareSigningBytesV1,
} from '../packages/contracts/src/index.ts';

const BASE_URL = 'http://127.0.0.1:18080';
const APP_ORIGIN = BASE_URL;
const SETUP_TOKEN = randomUUID();
const SOURCE_PROJECT = 'baby-care-m5';
const RESTORE_PROJECT = 'baby-care-m5-restore';
const PROCESS_TIMEOUT_MS = 240_000;
const MAX_CHILD_OUTPUT_BYTES = 1_048_576;
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const M5_MARKERS = Object.freeze([
  'SMOKE_OK component=m5-device-lease',
  'SMOKE_OK component=m5-feeding-confirm',
  'SMOKE_OK component=m5-recovery',
  'SMOKE_OK component=m5-voice-care-feeding-pilot',
]);
const ALLOWED_CHILD_FAILURE_CODES = new Set([
  'backup_catalogue_invalid',
  'backup_cleanup_required',
  'backup_dump_failed',
  'backup_durability_failed',
  'backup_exists',
  'backup_failed',
  'backup_helper_protocol_failed',
  'backup_helper_unavailable',
  'backup_integrity_failed',
  'backup_invalid_bundle',
  'backup_invalid_config',
  'backup_manifest_invalid',
  'backup_migration_invalid',
  'backup_postgres_incompatible',
  'backup_publish_failed',
  'backup_quarantine_failed',
  'backup_tool_failed',
  'backup_unsafe_storage',
  'backup_verification_failed',
  'operator_config_invalid',
  'operator_failed',
  'operator_process_failed',
  'restore_bundle_changed',
  'restore_failed',
  'restore_identity_unknown',
  'restore_invalid_config',
  'restore_invariant_failed',
  'restore_postgres_incompatible',
  'restore_read_model_failed',
  'restore_same_cluster',
  'restore_sanitation_failed',
  'restore_snapshot_failed',
  'restore_target_check_failed',
  'restore_target_not_empty',
]);
const SOURCE_COMPOSE = Object.freeze([
  'compose', '--profile', 'operations', '--project-name', SOURCE_PROJECT,
  '--file', 'compose.yaml', '--file', 'infra/backup/compose.operations.yaml',
]);
const RESTORE_COMPOSE = Object.freeze([
  'compose', '--profile', 'operations', '--project-name', RESTORE_PROJECT,
  '--file', 'compose.yaml', '--file', 'infra/backup/compose.operations.yaml',
]);
const COMPOSE_ENV = Object.freeze({
  ...process.env,
  VOICE_CARE_ENABLED: 'true',
  BABY_CARE_SETUP_TOKEN: SETUP_TOKEN,
  BABY_CARE_WEB_PORT: '18080',
  BABY_CARE_API_PORT: '18787',
});

let currentStage = 'bootstrap';
let lastFailureCode = 'unknown';
let sourceOwned = false;
let restoreOwned = false;
let backupParent;
const emittedMarkers = new Set();

async function safePrivateTempRoot() {
  try {
    const canonicalRepositoryRoot = await realpath(REPOSITORY_ROOT);
    const canonicalTempRoot = await realpath(tmpdir());
    const relation = relative(canonicalRepositoryRoot, canonicalTempRoot);
    if (
      relation === ''
      || (relation !== '..' && !relation.startsWith('..' + sep) && !isAbsolute(relation))
    ) throw new Error('unsafe temporary root');
    return canonicalTempRoot;
  } catch {
    lastFailureCode = 'backup_unsafe_storage';
    throw new Error('m5_temp_root_unsafe');
  }
}

function emitMarker(marker) {
  if (M5_MARKERS[emittedMarkers.size] !== marker || emittedMarkers.has(marker)) {
    throw new Error('m5_marker_invalid');
  }
  emittedMarkers.add(marker);
  console.log(marker);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runChild(command, args, options = {}) {
  const { env = process.env, input, timeoutMs = PROCESS_TIMEOUT_MS } = options;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let settled = false;
    let terminating = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      try { child.kill('SIGTERM'); } catch { /* bounded close remains authoritative */ }
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* bounded close remains authoritative */ }
        finish(new Error('m5_child_failed'));
      }, 1_000).unref();
    };
    const timer = setTimeout(terminate, timeoutMs);
    timer.unref();
    const collect = (target) => (chunk) => {
      const value = Buffer.from(chunk);
      outputBytes += value.byteLength;
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) terminate();
      else target.push(value);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', terminate);
    child.stdin.once('error', terminate);
    child.once('close', (code) => {
      if (terminating || code !== 0) {
        const candidate = Buffer.concat(stderr).toString('utf8').trim();
        lastFailureCode = ALLOWED_CHILD_FAILURE_CODES.has(candidate) ? candidate : 'unknown';
        finish(new Error('m5_child_failed'));
      } else finish(undefined, Buffer.concat(stdout));
    });
    child.stdin.end(input);
  });
}

async function runExpected(command, args, expected, options = {}) {
  const output = await runChild(command, args, options);
  if (output.toString('utf8').trim() !== expected) throw new Error('m5_child_protocol_failed');
}

async function projectObjects(project) {
  const values = await Promise.all([
    runChild('docker', ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${project}`]),
    runChild('docker', ['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${project}`]),
    runChild('docker', ['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${project}`]),
  ]);
  return values.some((value) => value.toString('utf8').trim());
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.status === 200) return;
    } catch { /* bounded startup retry */ }
    await sleep(1_000);
  }
  throw new Error('m5_api_unavailable');
}

async function waitForRestoreTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const output = await runChild('docker', [
        ...RESTORE_COMPOSE, 'exec', '--no-TTY', 'postgres_restore', 'pg_isready',
        '--username=babycare', '--dbname=babycare',
      ], { env: COMPOSE_ENV, timeoutMs: 10_000 });
      if (output.toString('utf8').includes('accepting connections')) return;
    } catch { /* bounded startup retry */ }
    await sleep(1_000);
  }
  throw new Error('m5_restore_target_unavailable');
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  if (!header || !/;\s*HttpOnly(?:;|$)/i.test(header) || !/;\s*SameSite=Lax(?:;|$)/i.test(header)) {
    throw new Error('m5_cookie_invalid');
  }
  const cookie = header.split(';', 1)[0];
  if (!cookie?.startsWith('baby_care_session=')) throw new Error('m5_cookie_invalid');
  return cookie;
}

async function request(path, options = {}) {
  const {
    method = 'GET', body, cookie, expectedStatus = 200, setupToken, voiceBody, binary = false,
  } = options;
  const headers = { accept: 'application/json' };
  if (!['GET', 'HEAD'].includes(method)) headers.origin = APP_ORIGIN;
  if (cookie) headers.cookie = cookie;
  if (setupToken) headers['x-baby-care-setup-token'] = setupToken;
  if (voiceBody) headers['content-type'] = 'application/vnd.baby-care.voice-intent+json';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: voiceBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(15_000),
  });
  let payload;
  if (response.status !== 204) {
    payload = binary ? Buffer.from(await response.arrayBuffer()) : await response.json();
  }
  if (response.status !== expectedStatus) throw new Error('m5_request_failed');
  return { response, payload };
}

function rawPublicKey(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return der.subarray(der.length - 32).toString('base64url');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

async function pairDevice(cookie, generatedDevice) {
  const challenge = (await request('/api/voice-care/pairing-challenges', {
    method: 'POST', expectedStatus: 201, cookie,
  })).payload;
  const unsigned = {
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    deviceId: randomUUID(),
    publicKey: rawPublicKey(generatedDevice.publicKey),
  };
  const input = {
    ...unsigned,
    signature: sign(
      null,
      voiceCarePairingSigningBytesV1(unsigned),
      generatedDevice.privateKey,
    ).toString('base64url'),
  };
  const paired = await request('/api/voice-care/devices', {
    method: 'POST', expectedStatus: 201, cookie, body: input,
  });
  if (paired.payload?.id !== unsigned.deviceId || paired.payload?.status !== 'active') {
    throw new Error('m5_pairing_invalid');
  }
  return unsigned.deviceId;
}

function signedIntent(device, leaseId, fields = {}) {
  const now = new Date().toISOString();
  const candidate = VoiceCareIntentV1Schema.parse({
    schemaVersion: 1,
    requestId: randomUUID(),
    deviceId: device.id,
    leaseId,
    issuedAt: now,
    occurredAt: now,
    deliveryMode: 'live',
    intentType: 'feeding_start',
    careSessionId: null,
    speakerState: 'verified',
    payload: { mode: 'unknown', startedAt: now },
    source: 'voice',
    modelVersion: 'synthetic-v1',
    signature: Buffer.alloc(64).toString('base64url'),
    ...fields,
  });
  const signed = VoiceCareIntentV1Schema.parse({
    ...candidate,
    signature: sign(null, voiceCareSigningBytesV1(candidate), device.privateKey).toString('base64url'),
  });
  return canonicalJson(signed);
}

async function sendIntent(raw) {
  const result = await request('/api/voice-care/intents', { method: 'POST', voiceBody: raw });
  return VoiceCareSemanticResultV1Schema.parse(result.payload);
}

async function activateLease(cookie, deviceId) {
  const lease = await request(`/api/voice-care/devices/${deviceId}/leases`, {
    method: 'POST', expectedStatus: 201, cookie,
    body: { clientRequestId: randomUUID(), occurredAt: new Date().toISOString() },
  });
  if (lease.payload?.deviceId !== deviceId || lease.payload?.revokedAt !== null) {
    throw new Error('m5_lease_invalid');
  }
  return lease.payload.id;
}

async function createPending(device, leaseId) {
  const now = new Date().toISOString();
  const start = await sendIntent(signedIntent(device, leaseId, {
    payload: { mode: 'bottle', startedAt: now },
  }));
  if (start.code !== 'accepted_pending' || !start.careSessionId) {
    throw new Error('m5_start_invalid');
  }
  return { sessionId: start.careSessionId, startedAt: now };
}

async function main() {
  currentStage = 'ownership';
  if (await projectObjects(SOURCE_PROJECT) || await projectObjects(RESTORE_PROJECT)) {
    throw new Error('m5_project_preexisting');
  }
  sourceOwned = true;
  currentStage = 'source-start';
  await runChild('docker', [
    ...SOURCE_COMPOSE, 'up', '--detach', '--build', 'postgres', 'api', 'web',
  ], { env: COMPOSE_ENV });
  await waitForApi();

  currentStage = 'setup';
  const dadPassword = randomUUID();
  const momPassword = randomUUID();
  const nannyPassword = randomUUID();
  await request('/api/setup', {
    method: 'POST', expectedStatus: 201, setupToken: SETUP_TOKEN,
    body: {
      familyName: 'M5 Synthetic Family', babyDisplayName: 'M5 Synthetic Baby',
      dad: { loginName: 'm5-dad', password: dadPassword },
      mom: { loginName: 'm5-mom', password: momPassword },
    },
  });
  const dadCookie = cookieFrom((await request('/api/auth/login', {
    method: 'POST', body: { loginName: 'm5-dad', password: dadPassword },
  })).response);
  const momCookie = cookieFrom((await request('/api/auth/login', {
    method: 'POST', body: { loginName: 'm5-mom', password: momPassword },
  })).response);
  await request('/api/family/members', {
    method: 'POST', expectedStatus: 201, cookie: dadCookie,
    body: { loginName: 'm5-nanny', displayName: 'M5 Nanny', password: nannyPassword },
  });
  const nannyCookie = cookieFrom((await request('/api/auth/login', {
    method: 'POST', body: { loginName: 'm5-nanny', password: nannyPassword },
  })).response);

  currentStage = 'device-lease';
  const generatedDevice = generateKeyPairSync('ed25519');
  const firstDevice = { id: await pairDevice(dadCookie, generatedDevice), privateKey: generatedDevice.privateKey };
  const firstLease = await activateLease(dadCookie, firstDevice.id);
  emitMarker(M5_MARKERS[0]);

  currentStage = 'feeding-confirm';
  currentStage = 'feeding-start';
  const pending = await createPending(firstDevice, firstLease);
  currentStage = 'feeding-update';
  const update = await sendIntent(signedIntent(firstDevice, firstLease, {
    intentType: 'feeding_update', careSessionId: pending.sessionId,
    payload: {
      expectedVersion: 1,
      proposal: {
        mode: 'bottle', startedAt: pending.startedAt, endedAt: null,
        liquidType: 'formula', amountMl: 90, bottleCapacityMl: 150,
      },
    },
  }));
  if (update.code !== 'accepted_pending' || update.sessionVersion !== 2) throw new Error('m5_update_invalid');
  currentStage = 'feeding-end';
  const end = await sendIntent(signedIntent(firstDevice, firstLease, {
    intentType: 'feeding_end', careSessionId: pending.sessionId,
    payload: {
      expectedVersion: 2,
      finalProposal: {
        mode: 'bottle', startedAt: pending.startedAt, endedAt: new Date().toISOString(),
        liquidType: 'formula', amountMl: 90, bottleCapacityMl: 150,
      },
    },
  }));
  if (end.code !== 'needs_confirmation' || !end.proposalDigest) throw new Error('m5_end_invalid');
  currentStage = 'feeding-confirm';
  const confirmRaw = signedIntent(firstDevice, firstLease, {
    intentType: 'care_confirm', careSessionId: pending.sessionId,
    payload: {
      expectedVersion: end.sessionVersion,
      proposalDigest: end.proposalDigest,
      warningDigest: end.warningDigest,
      confirmedWarningCodes: end.warningCodes,
    },
  });
  const confirmed = await sendIntent(confirmRaw);
  const duplicateConfirmation = await sendIntent(confirmRaw);
  if (
    confirmed.code !== 'saved' || !confirmed.careEventId ||
    duplicateConfirmation.careEventId !== confirmed.careEventId
  ) throw new Error('m5_confirmation_invalid');

  currentStage = 'feeding-cancel';
  const second = await createPending(firstDevice, firstLease);
  const cancelledSession = await request(`/api/voice-care/sessions/${second.sessionId}/cancel`, {
    method: 'POST', cookie: dadCookie,
    body: { expectedVersion: 1, reason: 'caregiver_cancelled' },
  });
  if (cancelledSession.payload?.code !== 'accepted_pending') throw new Error('m5_cancel_invalid');
  currentStage = 'device-revoke';
  await request(`/api/voice-care/devices/${firstDevice.id}`, { method: 'DELETE', cookie: dadCookie });
  const revokedIntent = await sendIntent(signedIntent(firstDevice, firstLease));
  if (revokedIntent.code !== 'rejected') throw new Error('m5_revocation_invalid');
  currentStage = 'manual-fallback';
  const nannyFallback = await request('/api/care/actions', {
    method: 'POST', expectedStatus: 201, cookie: nannyCookie,
    body: {
      occurredAt: new Date().toISOString(),
      clientRequestId: randomUUID(),
      action: { kind: 'burping' },
    },
  });
  if (typeof nannyFallback.payload?.id !== 'string') throw new Error('m5_fallback_invalid');
  emitMarker(M5_MARKERS[1]);

  currentStage = 'recovery-source';
  const recoveryKeys = generateKeyPairSync('ed25519');
  const recoveryDevice = { id: await pairDevice(momCookie, recoveryKeys), privateKey: recoveryKeys.privateKey };
  const recoveryLease = await activateLease(momCookie, recoveryDevice.id);
  await createPending(recoveryDevice, recoveryLease);
  const state = await request('/api/voice-care/state', { cookie: momCookie });
  if (state.payload?.activeLeases?.length !== 1) throw new Error('m5_recovery_source_invalid');
  const exported = await request('/api/family/export', { method: 'POST', cookie: dadCookie, binary: true });
  const document = FamilyExportSchemaV2.parse(JSON.parse(exported.payload.toString('utf8')));
  if (document.voiceCareSessions.length < 3) throw new Error('m5_export_invalid');

  backupParent = await mkdtemp(join(await safePrivateTempRoot(), 'baby-care-m5-'));
  await chmod(backupParent, 0o700);
  const operatorEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BABY_CARE_'))),
    BABY_CARE_BACKUP_PARENT: backupParent,
    BABY_CARE_BACKUP_BUNDLE: 'baby-care-backup-20260823T120000Z',
    BABY_CARE_COMPOSE_PROJECT: SOURCE_PROJECT,
    BABY_CARE_RESTORE_PROJECT: RESTORE_PROJECT,
    BABY_CARE_SOURCE_SERVICE: 'postgres',
    BABY_CARE_RESTORE_SERVICE: 'postgres_restore',
    BABY_CARE_RESTORE_PROBE_SERVICE: 'restored_api_probe',
  };
  await runExpected('pnpm', ['--silent', 'backup:create'], 'backup_created', { env: operatorEnv });
  await runExpected('pnpm', ['--silent', 'backup:verify'], 'backup_verified', { env: operatorEnv });

  currentStage = 'restore-target';
  restoreOwned = true;
  await runChild('docker', [
    ...RESTORE_COMPOSE, 'up', '--detach', '--build', 'postgres_restore', 'operations_verifier',
  ], { env: COMPOSE_ENV });
  await waitForRestoreTarget();
  await runExpected('pnpm', ['--silent', 'backup:restore'], 'restore_verified', { env: operatorEnv });
  const authority = await runChild('docker', [
    ...RESTORE_COMPOSE, 'exec', '--no-TTY', 'postgres_restore',
    'psql', '--no-psqlrc', '--tuples-only', '--no-align', '--field-separator=\t',
    '--username=babycare', '--dbname=babycare', '--command',
    `select (select count(*) from voice_care_leases where revoked_at is null),
            (select count(*) from voice_care_feeding_sessions where state in ('pending','needs_confirmation','committing')),
            (select count(*) from voice_care_leases where revoked_at is not null),
            (select count(*) from voice_care_feeding_sessions where restore_invalidated_at is not null),
            (select count(*) from voice_care_feeding_sessions where state = 'committed')`,
  ], { env: COMPOSE_ENV });
  const [activeLeaseCount, actionableSessionCount, revokedVoiceCareLeaseCount,
    invalidatedVoiceCareSessionCount, committedSessionCount] = authority.toString('utf8').trim().split('\t').map(Number);
  if (
    activeLeaseCount !== 0 || actionableSessionCount !== 0 ||
    revokedVoiceCareLeaseCount < 1 || invalidatedVoiceCareSessionCount !== 1 ||
    committedSessionCount !== 1
  ) throw new Error('m5_recovery_invalid');
  emitMarker(M5_MARKERS[2]);
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  let cleanupFailed = false;
  if (restoreOwned) {
    try {
      await runChild('docker', [...RESTORE_COMPOSE, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], { env: COMPOSE_ENV });
    } catch { cleanupFailed = true; }
  }
  if (sourceOwned) {
    try {
      await runChild('docker', [...SOURCE_COMPOSE, 'down', '--volumes', '--remove-orphans', '--timeout', '10'], { env: COMPOSE_ENV });
    } catch { cleanupFailed = true; }
  }
  if (backupParent) {
    try { await rm(backupParent, { recursive: true, force: true }); } catch { cleanupFailed = true; }
  }
  if (cleanupFailed && !failure) failure = new Error('m5_cleanup_failed');
}

if (failure) {
  process.stderr.write(`M5_SMOKE_FAILED stage=${currentStage} code=${lastFailureCode}\n`);
  process.exitCode = 1;
} else {
  emitMarker(M5_MARKERS[3]);
}
