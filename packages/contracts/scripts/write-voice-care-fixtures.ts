import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const INSTANT = '2026-08-23T08:00:00.000Z';
const SIGNATURE = 'A'.repeat(86);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}

const envelope = {
  schemaVersion: 1,
  requestId: REQUEST_ID,
  deviceId: DEVICE_ID,
  leaseId: LEASE_ID,
  issuedAt: INSTANT,
  occurredAt: INSTANT,
  deliveryMode: 'live',
  speakerState: 'verified',
  source: 'voice',
  modelVersion: 'synthetic-v1',
  signature: SIGNATURE,
};

const start = {
  ...envelope,
  intentType: 'feeding_start',
  careSessionId: null,
  payload: { mode: 'bottle', startedAt: INSTANT },
};
const update = {
  ...envelope,
  requestId: '55555555-5555-4555-8555-555555555555',
  intentType: 'feeding_update',
  careSessionId: SESSION_ID,
  payload: {
    expectedVersion: 1,
    proposal: {
      mode: 'bottle',
      startedAt: INSTANT,
      endedAt: null,
      liquidType: 'formula',
      amountMl: 90,
      bottleCapacityMl: 160,
    },
  },
};
const end = {
  ...envelope,
  requestId: '66666666-6666-4666-8666-666666666666',
  intentType: 'feeding_end',
  careSessionId: SESSION_ID,
  payload: {
    expectedVersion: 2,
    finalProposal: {
      mode: 'direct_breastfeeding',
      startedAt: INSTANT,
      endedAt: '2026-08-23T08:20:00.000Z',
      durationMinutes: 20,
    },
  },
};
const confirm = {
  ...envelope,
  requestId: '77777777-7777-4777-8777-777777777777',
  intentType: 'care_confirm',
  careSessionId: SESSION_ID,
  payload: {
    proposalDigest: 'a'.repeat(64),
    expectedVersion: 3,
    warningDigest: null,
    confirmedWarningCodes: [],
  },
};
const cancel = {
  ...envelope,
  requestId: '88888888-8888-4888-8888-888888888888',
  intentType: 'care_cancel',
  careSessionId: SESSION_ID,
  payload: { expectedVersion: 3, reason: 'caregiver_cancelled' },
};

const corpus = {
  schemaVersion: 1,
  schemaId: 'voice-care-intent.v1',
  valid: [
    { name: 'feeding-start', raw: canonical(start) },
    { name: 'feeding-update', raw: canonical(update) },
    { name: 'feeding-end', raw: canonical(end) },
    { name: 'care-confirm', raw: canonical(confirm) },
    { name: 'care-cancel', raw: canonical(cancel) },
  ],
  invalid: [
    { name: 'leading-whitespace', raw: ` ${canonical(start)}` },
    { name: 'duplicate-key', raw: canonical(start).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1') },
    { name: 'transcript-field', raw: canonical({ ...start, transcript: 'synthetic words' }) },
    { name: 'actor-field', raw: canonical({ ...start, actorUserId: REQUEST_ID }) },
    { name: 'wrong-session-shape', raw: canonical({ ...start, careSessionId: SESSION_ID }) },
    { name: 'wrong-payload', raw: canonical({ ...start, payload: { expectedVersion: 1 } }) },
    { name: 'invalid-signature', raw: canonical({ ...start, signature: 'invalid' }) },
    { name: 'unsupported-version', raw: canonical({ ...start, schemaVersion: 2 }) },
    { name: 'warning-set-without-digest', raw: canonical({
      ...confirm,
      payload: { ...confirm.payload, confirmedWarningCodes: ['possible_duplicate'] },
    }) },
    { name: 'noncanonical-key-order', raw: JSON.stringify(start) },
  ],
};

const target = fileURLToPath(new URL('../fixtures/voice-care-v1.json', import.meta.url));
const serialized = `${JSON.stringify(corpus, null, 2)}\n`;

if (process.argv.slice(2).includes('--check')) {
  const existing = await readFile(target, 'utf8').catch(() => '');
  if (existing !== serialized) {
    process.stderr.write('voice_care_fixtures_out_of_date\n');
    process.exitCode = 1;
  }
} else {
  await writeFile(target, serialized, { encoding: 'utf8', mode: 0o644 });
  process.stdout.write('voice_care_fixtures_written\n');
}
