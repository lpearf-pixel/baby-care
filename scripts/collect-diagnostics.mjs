import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUTPUT_DIR = resolve('diagnostics/latest');
const MAX_EVIDENCE_CHARS = 2048;
const REDACTED = '[REDACTED]';
const TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS = new Set(['passed', 'failed', 'failure', 'success', 'error', 'cancelled', 'skipped', 'timed_out', 'active', 'voided']);
const TRUSTED_FIELDS = new Set([
  'schema_version', 'event_id', 'event_type', 'status', 'trace_id',
  'duration_ms', 'elapsed_ms', 'timing_ms', 'code', 'error_code',
  'event_code', 'sqlstate', 'constraint',
]);

function safeDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
}

function parseTrustedMetadata(serialized) {
  if (!serialized) return null;
  let value;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !TRUSTED_FIELDS.has(key))) return null;
  if (value.schema_version !== 1) return null;
  const validators = {
    event_id: (entry) => typeof entry === 'string' && UUID.test(entry),
    event_type: (entry) => typeof entry === 'string' && TOKEN.test(entry) && entry.length <= 64,
    status: (entry) => (typeof entry === 'string' && STATUS.has(entry)) || (Number.isInteger(entry) && entry >= 100 && entry <= 599),
    trace_id: (entry) => typeof entry === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(entry),
    duration_ms: safeDuration,
    elapsed_ms: safeDuration,
    timing_ms: safeDuration,
    code: (entry) => typeof entry === 'string' && TOKEN.test(entry),
    error_code: (entry) => typeof entry === 'string' && TOKEN.test(entry),
    event_code: (entry) => typeof entry === 'string' && TOKEN.test(entry),
    sqlstate: (entry) => typeof entry === 'string' && /^[A-Za-z0-9]{5}$/.test(entry),
    constraint: (entry) => typeof entry === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(entry),
  };
  const metadata = { schema_version: 1 };
  for (const [key, validator] of Object.entries(validators)) {
    if (value[key] === undefined) continue;
    if (!validator(value[key])) return null;
    metadata[key] = value[key];
  }
  return Object.keys(metadata).length > 1 ? metadata : null;
}

function trustedEvidence(serialized) {
  const metadata = parseTrustedMetadata(serialized);
  return metadata ? `${REDACTED}\n${JSON.stringify(metadata)}` : REDACTED;
}

function truncateTail(value, maximum = MAX_EVIDENCE_CHARS) {
  if (value.length <= maximum) return value;
  const marker = '[truncated]\n';
  return `${marker}${value.slice(-(maximum - marker.length))}`;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const evidence = truncateTail(trustedEvidence(process.env.DIAG_TRUSTED_METADATA));

const summary = {
  schema_version: 1,
  status: 'failure',
  stage: process.env.DIAG_STAGE || 'unknown',
  component: process.env.DIAG_COMPONENT || 'unknown',
  event_code: process.env.DIAG_EVENT_CODE || 'CI_STAGE_FAILED',
  evidence,
  generated_at: new Date().toISOString(),
};

const environment = {
  schema_version: 1,
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  github_sha: process.env.GITHUB_SHA || null,
  github_run_id: process.env.GITHUB_RUN_ID || null,
  runner_os: process.env.RUNNER_OS || null,
};

await writeJson(`${OUTPUT_DIR}/summary.json`, summary);
await writeJson(`${OUTPUT_DIR}/environment.json`, environment);
await writeJson(`${OUTPUT_DIR}/artifact-index.json`, {
  schema_version: 1,
  files: ['summary.json', 'environment.json', 'artifact-index.json'],
});

process.stdout.write(`${JSON.stringify(summary)}\n`);
