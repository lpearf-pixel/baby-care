import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FamilyExportSchemaV1 } from '../packages/contracts/src/index.ts';

const BASE_URL = 'http://127.0.0.1:8080';
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-development-setup-token-change-me';
const PROCESS_TIMEOUT_MS = 180_000;
const MAX_CHILD_OUTPUT_BYTES = 1_048_576;
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const M4_MARKERS = Object.freeze([
  'SMOKE_OK component=m4-family-export',
  'SMOKE_OK component=m4-backup-integrity',
  'SMOKE_OK component=m4-isolated-restore',
  'SMOKE_OK component=m4-birth-ready-operations',
]);
const STABLE_COMPARISON_KEYS = Object.freeze([
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
]);
const COMPOSE_PREFIX = Object.freeze([
  'compose',
  '--profile',
  'operations',
  '--project-name',
  'baby-care-restore',
  '--file',
  'compose.yaml',
  '--file',
  'infra/backup/compose.operations.yaml',
]);

const emittedMarkers = new Set();
let currentStage = 'bootstrap';
let lastFailureCode = 'unknown';

function emitMarker(marker) {
  if (!M4_MARKERS.includes(marker) || emittedMarkers.has(marker)) throw new Error('m4_marker_invalid');
  const expected = M4_MARKERS[emittedMarkers.size];
  if (marker !== expected) throw new Error('m4_marker_order_invalid');
  emittedMarkers.add(marker);
  console.log(marker);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function minutesBefore(value, minutes) {
  return new Date(value.getTime() - minutes * 60_000).toISOString();
}

function recentFamilyMidnight(now) {
  let offsetHours = 2 - now.getUTCHours();
  while (offsetHours < -12) offsetHours += 24;
  while (offsetHours > 11) offsetHours -= 24;
  const offsetMilliseconds = offsetHours * 60 * 60_000;
  const dayMilliseconds = 24 * 60 * 60_000;
  let instant = Math.floor((now.getTime() + offsetMilliseconds) / dayMilliseconds) * dayMilliseconds
    - offsetMilliseconds;
  if (instant > now.getTime()) instant -= dayMilliseconds;
  const timeZone = offsetHours === 0
    ? 'Etc/UTC'
    : `Etc/GMT${offsetHours > 0 ? '-' : '+'}${Math.abs(offsetHours)}`;
  return { midnight: new Date(instant), timeZone };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function stableFactsFromViews(views) {
  if (!Array.isArray(views.timeline?.items) || !Array.isArray(views.revisions)) {
    throw new Error('m4_read_model_invalid');
  }
  const items = [...views.timeline.items].sort((left, right) => left.id.localeCompare(right.id));
  const checkpointIds = new Set([
    views.latestHandoff?.checkpoint?.id,
    views.latestHandoff?.previousCheckpoint?.id,
    views.fixedHandoff?.checkpoint?.id,
    views.fixedHandoff?.previousCheckpoint?.id,
  ].filter((value) => typeof value === 'string'));
  return {
    timelineDigest: digest(views.timeline),
    summaryDigest: digest(views.summary),
    revisionDigest: digest(views.revisions),
    handoffDigest: digest({ latest: views.latestHandoff, fixed: views.fixedHandoff }),
    actorDigest: digest(items.map((item) => ({
      id: item.id,
      actorUserId: item.actorUserId,
      actorDisplayName: item.actorDisplayName,
      source: item.source,
    }))),
    statusDigest: digest(items.map((item) => ({ id: item.id, status: item.status, version: item.version }))),
    eventCount: items.length,
    revisionCount: views.revisions.length,
    checkpointCount: checkpointIds.size,
    maxVersion: items.reduce((maximum, item) => Math.max(maximum, item.version ?? 0), 0),
  };
}

function validateStableFacts(value) {
  for (const key of STABLE_COMPARISON_KEYS) {
    const fact = value[key];
    if (typeof fact !== 'string' && !Number.isSafeInteger(fact)) throw new Error('m4_stable_fact_invalid');
  }
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  if (!header || !/;\s*HttpOnly(?:;|$)/i.test(header) || !/;\s*SameSite=Lax(?:;|$)/i.test(header)) {
    throw new Error('m4_cookie_policy_invalid');
  }
  const cookie = header.split(';', 1)[0];
  if (!cookie?.startsWith('baby_care_session=')) throw new Error('m4_cookie_invalid');
  return cookie;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.status === 200) return;
    } catch {
      // Keep the bounded health wait private and retry.
    }
    await sleep(1_000);
  }
  throw new Error('m4_api_unavailable');
}

async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    cookie,
    expectedStatus = 200,
    setupToken,
    binary = false,
  } = options;
  const headers = { accept: 'application/json' };
  if (!['GET', 'HEAD'].includes(method)) headers.origin = APP_ORIGIN;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (setupToken) headers['x-baby-care-setup-token'] = setupToken;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  let payload;
  if (response.status !== 204) {
    payload = binary
      ? Buffer.from(await response.arrayBuffer())
      : await response.json();
  }
  if (response.status !== expectedStatus) throw new Error('m4_request_failed');
  return { response, payload };
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
    const output = [];
    const errorOutput = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let failed = false;
    let settled = false;
    let forcedKill;
    let hardSettlement;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forcedKill) clearTimeout(forcedKill);
      if (hardSettlement) clearTimeout(hardSettlement);
      if (error) reject(error);
      else resolve(value);
    };
    const fail = () => {
      failed = true;
      if (settled || forcedKill) return;
      try {
        child.kill('SIGTERM');
      } catch {
        // The close/error event remains authoritative.
      }
      forcedKill = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The outer timeout still bounds settlement.
        }
        hardSettlement = setTimeout(() => finish(new Error('m4_child_failed')), 1_000);
        hardSettlement.unref();
      }, 1_000);
      forcedKill.unref();
    };
    const timeout = setTimeout(fail, timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > MAX_CHILD_OUTPUT_BYTES) return fail();
      output.push(buffer);
    });
    child.stderr.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      errorBytes += buffer.byteLength;
      if (errorBytes > MAX_CHILD_OUTPUT_BYTES) fail();
      else errorOutput.push(buffer);
    });
    child.once('error', fail);
    child.stdin.once('error', fail);
    child.once('close', (code) => {
      if (failed || code !== 0) {
        const candidate = Buffer.concat(errorOutput).toString('utf8').trim();
        if (/^[a-z][a-z0-9_]{0,127}$/.test(candidate)) lastFailureCode = candidate;
        finish(new Error('m4_child_failed'));
      }
      else finish(undefined, Buffer.concat(output));
    });
    if (input === undefined) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function runExpected(command, args, expected, options = {}) {
  const output = await runChild(command, args, options);
  if (output.toString('utf8').trim() !== expected) throw new Error('m4_child_protocol_failed');
}

async function waitForRestoreTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const postgres = await runChild('docker', [
        ...COMPOSE_PREFIX,
        'exec',
        '--no-TTY',
        'postgres_restore',
        'pg_isready',
        '--username=babycare',
        '--dbname=babycare',
      ], { timeoutMs: 10_000 });
      const verifier = await runChild('docker', [
        ...COMPOSE_PREFIX,
        'ps',
        '--status',
        'running',
        '--quiet',
        'operations_verifier',
      ], { timeoutMs: 10_000 });
      if (postgres.toString('utf8').includes('accepting connections') && verifier.toString('utf8').trim()) return;
    } catch {
      // Keep target diagnostics bounded and private.
    }
    await sleep(1_000);
  }
  throw new Error('m4_restore_target_unavailable');
}

const RESTORED_API_VERIFIER_SOURCE = String.raw`
import { createHash } from 'node:crypto';
import { buildApp } from './src/app.ts';
import { createDatabase } from './src/db.ts';

const APP_ORIGIN = 'http://127.0.0.1:8080';
const STABLE_COMPARISON_KEYS = [
  'timelineDigest', 'summaryDigest', 'revisionDigest', 'handoffDigest', 'actorDigest',
  'statusDigest', 'eventCount', 'revisionCount', 'checkpointCount', 'maxVersion',
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function facts(views) {
  if (!Array.isArray(views.timeline?.items) || !Array.isArray(views.revisions)) throw new Error('invalid_views');
  const items = [...views.timeline.items].sort((left, right) => left.id.localeCompare(right.id));
  const checkpointIds = new Set([
    views.latestHandoff?.checkpoint?.id,
    views.latestHandoff?.previousCheckpoint?.id,
    views.fixedHandoff?.checkpoint?.id,
    views.fixedHandoff?.previousCheckpoint?.id,
  ].filter((value) => typeof value === 'string'));
  return {
    timelineDigest: digest(views.timeline),
    summaryDigest: digest(views.summary),
    revisionDigest: digest(views.revisions),
    handoffDigest: digest({ latest: views.latestHandoff, fixed: views.fixedHandoff }),
    actorDigest: digest(items.map((item) => ({
      id: item.id,
      actorUserId: item.actorUserId,
      actorDisplayName: item.actorDisplayName,
      source: item.source,
    }))),
    statusDigest: digest(items.map((item) => ({ id: item.id, status: item.status, version: item.version }))),
    eventCount: items.length,
    revisionCount: views.revisions.length,
    checkpointCount: checkpointIds.size,
    maxVersion: items.reduce((maximum, item) => Math.max(maximum, item.version ?? 0), 0),
  };
}

function assertStableFactsEqual(sourceFacts, restoredFacts) {
  for (const key of STABLE_COMPARISON_KEYS) {
    if (restoredFacts[key] !== sourceFacts[key]) throw new Error('comparison_failed');
  }
}

function json(response) {
  const value = response.json();
  if (value === undefined) throw new Error('missing_json');
  return value;
}

async function inject(app, path, { method = 'GET', body, cookie, expectedStatus = 200 } = {}) {
  const headers = {};
  if (!['GET', 'HEAD'].includes(method)) headers.origin = APP_ORIGIN;
  if (cookie) headers.cookie = cookie;
  const response = await app.inject({ method, url: path, headers, payload: body });
  if (response.statusCode !== expectedStatus) throw new Error('request_failed');
  return response;
}

function cookieFrom(response) {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const cookie = typeof header === 'string' ? header.split(';', 1)[0] : undefined;
  if (!cookie?.startsWith('baby_care_session=')) throw new Error('cookie_invalid');
  return cookie;
}

const input = __M4_VERIFIER_INPUT__;
const database = createDatabase(process.env.DATABASE_URL);
const app = buildApp({
  checkDatabase: database.checkDatabase,
  database,
  appOrigin: APP_ORIGIN,
  setupToken: 'restore-probe-setup-token',
  sessionSecure: false,
});

try {
  const oldCookieDenied = await inject(app, '/api/auth/session', {
    cookie: input.oldCookie,
    expectedStatus: 401,
  });
  if (json(oldCookieDenied).code !== 'unauthenticated') throw new Error('old_cookie_accepted');
  const freshDadLogin = await inject(app, '/api/auth/login', {
    method: 'POST',
    body: { loginName: input.loginName, password: input.password },
  });
  const cookie = cookieFrom(freshDadLogin);
  await inject(app, '/api/auth/session', { cookie });
  const summary = json(await inject(app, input.routes.summary, { cookie }));
  const timeline = json(await inject(app, input.routes.timeline, { cookie }));
  const revisions = json(await inject(app, input.routes.revisions, { cookie }));
  const latestHandoff = json(await inject(app, '/api/care/handoffs/latest', { cookie }));
  const fixedHandoff = json(await inject(app, input.routes.fixedHandoff, { cookie }));
  const restoredFacts = facts({ summary, timeline, revisions, latestHandoff, fixedHandoff });
  assertStableFactsEqual(input.expectedFacts, restoredFacts);
  process.stdout.write('m4_restored_api_verified\n');
} finally {
  await app.close();
  await database.close();
}
`;

function restoredVerifierProgram(input) {
  return RESTORED_API_VERIFIER_SOURCE.replace('__M4_VERIFIER_INPUT__', JSON.stringify(input));
}

async function collectSourceViews(cookie, routes) {
  const summary = (await request(routes.summary, { cookie })).payload;
  const timeline = (await request(routes.timeline, { cookie })).payload;
  const revisions = (await request(routes.revisions, { cookie })).payload;
  const latestHandoff = (await request('/api/care/handoffs/latest', { cookie })).payload;
  const fixedHandoff = (await request(routes.fixedHandoff, { cookie })).payload;
  return { summary, timeline, revisions, latestHandoff, fixedHandoff };
}

async function main() {
  currentStage = 'source-health';
  await waitForApi();
  const setupStatus = await request('/api/setup/status');
  if (setupStatus.payload?.required !== true) throw new Error('m4_source_not_empty');

  const dadLoginName = 'm4-dad';
  const dadPassword = 'm4-dad-generated-password';
  const momLoginName = 'm4-mom';
  const momPassword = 'm4-mom-generated-password';
  const nannyLoginName = 'm4-nanny';
  const nannyPassword = 'm4-nanny-generated-password';
  await request('/api/setup', {
    method: 'POST',
    expectedStatus: 201,
    setupToken: SETUP_TOKEN,
    body: {
      familyName: 'M4 Synthetic Family',
      babyDisplayName: 'M4 Synthetic Baby',
      dad: { loginName: dadLoginName, password: dadPassword },
      mom: { loginName: momLoginName, password: momPassword },
    },
  });

  currentStage = 'identity';
  const dadLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { loginName: dadLoginName, password: dadPassword },
  });
  const dadCookie = cookieFrom(dadLogin.response);
  const momLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { loginName: momLoginName, password: momPassword },
  });
  const momCookie = cookieFrom(momLogin.response);
  await request('/api/auth/session', { cookie: dadCookie });
  await request('/api/auth/session', { cookie: momCookie });

  const familyClock = recentFamilyMidnight(new Date());
  await request('/api/family', {
    method: 'PATCH',
    cookie: dadCookie,
    body: { timezone: familyClock.timeZone },
  });
  await request('/api/family/members', {
    method: 'POST',
    expectedStatus: 201,
    cookie: dadCookie,
    body: { loginName: nannyLoginName, displayName: 'M4 Nanny', password: nannyPassword },
  });
  const nannyLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { loginName: nannyLoginName, password: nannyPassword },
  });
  const nannyCookie = cookieFrom(nannyLogin.response);
  const nannySession = await request('/api/auth/session', { cookie: nannyCookie });
  if (nannySession.payload?.permissionLevel !== 'caregiver') throw new Error('m4_nanny_role_invalid');

  currentStage = 'care-recording';
  const familyMidnight = familyClock.midnight;
  const dadHandoff = await request('/api/care/handoffs', {
    method: 'POST',
    expectedStatus: 201,
    cookie: dadCookie,
    body: { occurredAt: minutesBefore(familyMidnight, 90), clientRequestId: randomUUID() },
  });
  if (dadHandoff.payload?.checkpoint?.actorDisplayName !== 'Dad') throw new Error('m4_dad_handoff_invalid');

  await request('/api/care/feeding-sessions', {
    method: 'POST',
    expectedStatus: 201,
    cookie: momCookie,
    body: {
      occurredAt: minutesBefore(familyMidnight, 85),
      clientRequestId: randomUUID(),
      components: [
        { kind: 'bottle', liquidType: 'formula', amountMl: 72, bottleCapacityMl: 150 },
        { kind: 'direct_breastfeeding', durationMinutes: 12 },
      ],
    },
  });
  const firstDiaper = await request('/api/care/diapers', {
    method: 'POST',
    expectedStatus: 201,
    cookie: nannyCookie,
    body: {
      occurredAt: minutesBefore(familyMidnight, 80),
      clientRequestId: randomUUID(),
      kind: 'urine_stool',
      stoolColor: 'synthetic-yellow',
      stoolConsistency: 'synthetic-soft',
      stoolAmount: 'medium',
    },
  });
  if (typeof firstDiaper.payload?.id !== 'string') throw new Error('m4_diaper_invalid');
  const duplicateWarning = await request('/api/care/diapers', {
    method: 'POST',
    expectedStatus: 409,
    cookie: dadCookie,
    body: {
      occurredAt: minutesBefore(familyMidnight, 79),
      clientRequestId: randomUUID(),
      kind: 'urine_stool',
      stoolColor: 'synthetic-yellow',
      stoolConsistency: 'synthetic-soft',
      stoolAmount: 'medium',
    },
  });
  const warningCodes = duplicateWarning.payload?.details?.warnings?.map((warning) => warning.code);
  if (duplicateWarning.payload?.code !== 'care_confirmation_required' || !warningCodes?.includes('possible_duplicate')) {
    throw new Error('m4_warning_invalid');
  }
  await request('/api/care/diapers', {
    method: 'POST',
    expectedStatus: 201,
    cookie: dadCookie,
    body: {
      occurredAt: minutesBefore(familyMidnight, 79),
      clientRequestId: randomUUID(),
      confirmedWarnings: warningCodes,
      kind: 'urine_stool',
      stoolColor: 'synthetic-yellow',
      stoolConsistency: 'synthetic-soft',
      stoolAmount: 'medium',
    },
  });

  await request('/api/care/sleep/start', {
    method: 'POST',
    expectedStatus: 201,
    cookie: momCookie,
    body: { occurredAt: minutesBefore(familyMidnight, 75), clientRequestId: randomUUID() },
  });
  await request('/api/care/sleep/wake', {
    method: 'POST',
    cookie: momCookie,
    body: { occurredAt: minutesBefore(familyMidnight, 45), clientRequestId: randomUUID() },
  });

  const actions = [
    [dadCookie, 70, { kind: 'burping' }],
    [nannyCookie, 65, { kind: 'spit_up', amount: 'small' }],
    [momCookie, 60, { kind: 'bathing' }],
    [momCookie, 35, {
      kind: 'medication',
      medicationName: 'Synthetic prescribed record',
      dose: 1,
      doseUnit: 'mL',
    }],
  ];
  for (const [cookie, minutes, action] of actions) {
    await request('/api/care/actions', {
      method: 'POST',
      expectedStatus: 201,
      cookie,
      body: { occurredAt: minutesBefore(familyMidnight, minutes), clientRequestId: randomUUID(), action },
    });
  }
  const measurements = [
    [dadCookie, 55, { kind: 'temperature', valueCelsius: 36.7, method: 'synthetic' }],
    [nannyCookie, 50, { kind: 'weight', valueKg: 4.2 }],
  ];
  for (const [cookie, minutes, measurement] of measurements) {
    await request('/api/care/measurements', {
      method: 'POST',
      expectedStatus: 201,
      cookie,
      body: { occurredAt: minutesBefore(familyMidnight, minutes), clientRequestId: randomUUID(), measurement },
    });
  }

  const revisedFeed = await request('/api/care/feeding-sessions', {
    method: 'POST',
    expectedStatus: 201,
    cookie: dadCookie,
    body: {
      occurredAt: minutesBefore(familyMidnight, 30),
      clientRequestId: randomUUID(),
      components: [{ kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 40 }],
    },
  });
  const revisedEventId = revisedFeed.payload?.id;
  if (typeof revisedEventId !== 'string') throw new Error('m4_revision_target_invalid');
  currentStage = 'revision-flow';
  const revisedAt = minutesBefore(familyMidnight, 30);
  await request(`/api/care/events/${revisedEventId}`, {
    method: 'PATCH',
    cookie: momCookie,
    body: {
      expectedVersion: 1,
      event: {
        eventType: 'feeding',
        occurredAt: revisedAt,
        components: [{ kind: 'bottle', liquidType: 'expressed_breast_milk', amountMl: 44 }],
      },
    },
  });
  const staleConflict = await request(`/api/care/events/${revisedEventId}/undo`, {
    method: 'POST',
    expectedStatus: 409,
    cookie: nannyCookie,
    body: { expectedVersion: 1 },
  });
  if (staleConflict.payload?.code !== 'care_state_conflict') throw new Error('m4_stale_conflict_invalid');
  const reconciled = await request(`/api/care/events/${revisedEventId}`, { cookie: nannyCookie });
  if (reconciled.payload?.version !== 2 || reconciled.payload?.status !== 'active') {
    throw new Error('m4_reconcile_invalid');
  }
  await request(`/api/care/events/${revisedEventId}/undo`, {
    method: 'POST',
    cookie: nannyCookie,
    body: { expectedVersion: 2 },
  });
  const revisionHistory = await request(`/api/care/events/${revisedEventId}/revisions`, { cookie: dadCookie });
  if (
    revisionHistory.payload?.length !== 2
    || revisionHistory.payload[0]?.action !== 'edit'
    || revisionHistory.payload[1]?.action !== 'void'
  ) throw new Error('m4_revision_history_invalid');

  const nannyHandoff = await request('/api/care/handoffs', {
    method: 'POST',
    expectedStatus: 201,
    cookie: nannyCookie,
    body: { occurredAt: minutesBefore(familyMidnight, 15), clientRequestId: randomUUID() },
  });
  const nannyCheckpointId = nannyHandoff.payload?.checkpoint?.id;
  currentStage = 'handoff-flow';
  if (
    typeof nannyCheckpointId !== 'string'
    || nannyHandoff.payload?.checkpoint?.actorDisplayName !== 'M4 Nanny'
    || nannyHandoff.payload?.previousCheckpoint?.id !== dadHandoff.payload?.checkpoint?.id
  ) throw new Error('m4_nanny_handoff_invalid');
  const fixedBriefing = await request(`/api/care/handoffs/${nannyCheckpointId}/summary`, { cookie: momCookie });
  if (fixedBriefing.payload?.checkpoint?.id !== nannyCheckpointId) throw new Error('m4_fixed_briefing_invalid');
  const momHandoff = await request('/api/care/handoffs', {
    method: 'POST',
    expectedStatus: 201,
    cookie: momCookie,
    body: { occurredAt: familyMidnight.toISOString(), clientRequestId: randomUUID() },
  });
  if (
    momHandoff.payload?.checkpoint?.actorDisplayName !== 'Mom'
    || momHandoff.payload?.previousCheckpoint?.id !== nannyCheckpointId
  ) throw new Error('m4_mom_handoff_invalid');

  const beforeReminders = await request('/api/care/handoffs/latest', { cookie: dadCookie });
  await request('/api/care/handoff-reminders', {
    method: 'PUT',
    cookie: dadCookie,
    body: { rules: [{ localTime: '23:55', weekdays: [1, 2, 3, 4, 5, 6, 7], enabled: true }] },
  });
  const reminders = await request('/api/care/handoff-reminders', { cookie: dadCookie });
  const afterReminders = await request('/api/care/handoffs/latest', { cookie: dadCookie });
  if (
    reminders.payload?.rules?.length !== 1
    || beforeReminders.payload?.checkpoint?.id !== momHandoff.payload?.checkpoint?.id
    || afterReminders.payload?.checkpoint?.id !== beforeReminders.payload?.checkpoint?.id
  ) throw new Error('m4_reminder_checkpoint_invalid');

  const sourceSummary = await request(`/api/care/summary?at=${encodeURIComponent(familyMidnight.toISOString())}`, {
    cookie: dadCookie,
  });
  if (
    sourceSummary.payload?.rolling24h?.formulaMl !== 72
    || sourceSummary.payload?.rolling24h?.directBreastfeedingMinutes !== 12
  ) throw new Error('m4_midnight_summary_invalid');

  currentStage = 'family-export';
  const dadExport = await request('/api/family/export', {
    method: 'POST',
    cookie: dadCookie,
    binary: true,
  });
  let dadExportDocument;
  try {
    dadExportDocument = FamilyExportSchemaV1.parse(JSON.parse(dadExport.payload.toString('utf8')));
  } finally {
    dadExport.payload.fill(0);
  }
  const momExport = await request('/api/family/export', {
    method: 'POST',
    cookie: momCookie,
    binary: true,
  });
  let momExportDocument;
  try {
    momExportDocument = FamilyExportSchemaV1.parse(JSON.parse(momExport.payload.toString('utf8')));
  } finally {
    momExport.payload.fill(0);
  }
  const nannyExportDenied = await request('/api/family/export', {
    method: 'POST',
    cookie: nannyCookie,
    expectedStatus: 403,
  });
  if (nannyExportDenied.payload?.code !== 'forbidden') throw new Error('m4_nanny_export_denial_invalid');
  const { generatedAt: dadGeneratedAt, ...dadStableExport } = dadExportDocument;
  const { generatedAt: momGeneratedAt, ...momStableExport } = momExportDocument;
  if (!dadGeneratedAt || !momGeneratedAt || digest(dadStableExport) !== digest(momStableExport)) {
    throw new Error('m4_admin_export_mismatch');
  }
  emitMarker(M4_MARKERS[0]);

  const routes = {
    summary: `/api/care/summary?at=${encodeURIComponent(familyMidnight.toISOString())}`,
    timeline: `/api/care/timeline?from=${encodeURIComponent(minutesBefore(familyMidnight, 24 * 60))}`
      + `&to=${encodeURIComponent(familyMidnight.toISOString())}&limit=50`,
    revisions: `/api/care/events/${revisedEventId}/revisions`,
    fixedHandoff: `/api/care/handoffs/${nannyCheckpointId}/summary`,
  };
  const sourceViews = await collectSourceViews(dadCookie, routes);
  currentStage = 'source-comparison';
  const sourceFacts = stableFactsFromViews(sourceViews);
  validateStableFacts(sourceFacts);
  const actors = new Set(sourceViews.timeline.items.map((item) => item.actorDisplayName));
  const eventTypes = new Set(sourceViews.timeline.items.map((item) => item.eventType));
  if (
    !actors.has('Dad') || !actors.has('Mom') || !actors.has('M4 Nanny')
    || !['feeding', 'diaper', 'sleep', 'burping', 'spit_up', 'bathing', 'medication', 'temperature', 'weight']
      .every((eventType) => eventTypes.has(eventType))
  ) throw new Error('m4_care_coverage_invalid');

  const privateTempRoot = await realpath(tmpdir());
  const backupParent = await mkdtemp(join(privateTempRoot, 'baby-care-m4-'));
  await chmod(backupParent, 0o700);
  const bundleName = `baby-care-backup-${new Date().toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z`;
  const operatorEnv = {
    ...process.env,
    BABY_CARE_BACKUP_PARENT: backupParent,
    BABY_CARE_BACKUP_BUNDLE: bundleName,
    BABY_CARE_COMPOSE_PROJECT: 'baby-care',
    BABY_CARE_RESTORE_PROJECT: 'baby-care-restore',
    BABY_CARE_SOURCE_SERVICE: 'postgres',
    BABY_CARE_RESTORE_SERVICE: 'postgres_restore',
    BABY_CARE_RESTORE_PROBE_SERVICE: 'restored_api_probe',
  };
  let targetOwned = false;
  let operationError;
  let cleanupFailed = false;
  try {
    currentStage = 'backup-create';
    await runExpected('pnpm', ['--silent', 'backup:create'], 'backup_created', { env: operatorEnv });
    currentStage = 'backup-verify';
    await runExpected('pnpm', ['--silent', 'backup:verify'], 'backup_verified', { env: operatorEnv });
    emitMarker(M4_MARKERS[1]);

    const preexistingTarget = await runChild('docker', [...COMPOSE_PREFIX, 'ps', '--all', '--quiet']);
    const preexistingVolume = await runChild('docker', [
      'volume', 'ls', '--quiet', '--filter', 'name=^baby-care-restore_babycare_restore$',
    ]);
    const preexistingNetwork = await runChild('docker', [
      'network', 'ls', '--quiet', '--filter', 'name=^baby-care-restore_default$',
    ]);
    if (
      preexistingTarget.toString('utf8').trim()
      || preexistingVolume.toString('utf8').trim()
      || preexistingNetwork.toString('utf8').trim()
    ) throw new Error('m4_restore_project_preexisting');
    targetOwned = true;
    currentStage = 'restore-target';
    await runChild('docker', [
      ...COMPOSE_PREFIX,
      'up',
      '--detach',
      '--no-deps',
      'postgres_restore',
      'operations_verifier',
    ]);
    await waitForRestoreTarget();
    currentStage = 'restore-verify';
    await runExpected('pnpm', ['--silent', 'backup:restore'], 'restore_verified', { env: operatorEnv });
    currentStage = 'restored-api';
    await runChild('docker', [
      ...COMPOSE_PREFIX,
      'up',
      '--detach',
      '--no-deps',
      'restored_api_probe',
    ]);
    const restoredProbeInput = restoredVerifierProgram({
      oldCookie: dadCookie,
      loginName: dadLoginName,
      password: dadPassword,
      routes,
      expectedFacts: sourceFacts,
    });
    await runExpected('docker', [
      ...COMPOSE_PREFIX,
      'exec',
      '--no-TTY',
      'restored_api_probe',
      'pnpm',
      '--filter',
      '@baby-care/api',
      'exec',
      'tsx',
      '-',
    ], 'm4_restored_api_verified', { input: restoredProbeInput });
  } catch (error) {
    operationError = error;
  } finally {
    if (targetOwned) {
      try {
        await runChild('docker', [
          ...COMPOSE_PREFIX,
          'down',
          '--volumes',
          '--remove-orphans',
          '--timeout',
          '10',
        ]);
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      await rm(backupParent, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error('m4_cleanup_failed');
  if (operationError) throw operationError;
  currentStage = 'complete';
  emitMarker(M4_MARKERS[2]);
  emitMarker(M4_MARKERS[3]);
}

try {
  await main();
} catch {
  process.stderr.write(`M4_SMOKE_FAILED stage=${currentStage} code=${lastFailureCode}\n`);
  process.exitCode = 1;
}
