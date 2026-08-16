import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUTPUT_DIR = resolve('diagnostics/latest');
const MAX_SOURCE_BYTES = 8192;
const MAX_EVIDENCE_CHARS = 2048;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'password',
  'passphrase',
  'authorization',
  'cookie',
  'set-cookie',
  'setupToken',
  'setup_token',
  'sessionToken',
  'session_token',
  'token',
  'amountMl',
  'amount_ml',
  'bottleCapacityMl',
  'bottle_capacity_ml',
  'liquidType',
  'liquid_type',
  'medicationName',
  'medication_name',
  'medicationDose',
  'medication_dose',
  'dose',
  'doseUnit',
  'dose_unit',
  'valueCelsius',
  'value_celsius',
  'temperature',
  'valueKg',
  'value_kg',
  'weight',
  'note',
  'durationMinutes',
  'duration_minutes',
  'stoolColor',
  'stool_color',
  'stoolConsistency',
  'stool_consistency',
  'stoolAmount',
  'stool_amount',
  'method',
  'components',
  'relatedActions',
  'related_actions',
  'before_json',
  'after_json',
  'beforeJson',
  'afterJson',
  'snapshot',
].map((key) => key.toLowerCase()));
const SAFE_DIAGNOSTIC_KEYS = new Set([
  'code',
  'error_code',
  'errorcode',
  'event_code',
  'eventcode',
  'constraint',
  'sqlstate',
  'stage',
  'component',
]);

function structuredValueEnd(value, start) {
  const first = value[start];
  if (first === '"' || first === "'") {
    for (let index = start + 1; index < value.length; index += 1) {
      if (value[index] === '\\') index += 1;
      else if (value[index] === first) return index + 1;
    }
    return value.length;
  }
  if (first === '{' || first === '[') {
    const openings = new Set(['{', '[']);
    const closings = new Map([['}', '{'], [']', '[']]);
    const stack = [];
    let quote = null;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index];
      if (quote) {
        if (character === '\\') index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (openings.has(character)) {
        stack.push(character);
      } else if (closings.has(character)) {
        if (stack.at(-1) !== closings.get(character)) return index;
        stack.pop();
        if (stack.length === 0) return index + 1;
      }
    }
    return value.length;
  }
  let end = start;
  while (end < value.length && !/[\s,}\]]/.test(value[end])) end += 1;
  return end;
}

function redactSensitiveFields(value) {
  const keyPattern = /(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([A-Za-z_][A-Za-z0-9_-]*))\s*[:=]\s*/g;
  let redacted = '';
  let copiedThrough = 0;
  let match;
  while ((match = keyPattern.exec(value)) !== null) {
    const key = (match[1] ?? match[2] ?? match[3] ?? '').toLowerCase();
    if (!SENSITIVE_KEYS.has(key) && SAFE_DIAGNOSTIC_KEYS.has(key)) continue;
    const valueStart = keyPattern.lastIndex;
    const valueEnd = structuredValueEnd(value, valueStart);
    redacted += value.slice(copiedThrough, valueStart);
    redacted += REDACTED;
    copiedThrough = valueEnd;
    keyPattern.lastIndex = valueEnd;
  }
  return `${redacted}${value.slice(copiedThrough)}`;
}

function redactSensitiveEvidence(value) {
  let redacted = value;
  redacted = redacted.replace(/baby_care_session=[^;\s"']+/gi, `baby_care_session=${REDACTED}`);
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`);
  return redactSensitiveFields(redacted);
}

function truncateTail(value, maximum = MAX_EVIDENCE_CHARS) {
  if (value.length <= maximum) return value;
  const marker = '[truncated]\n';
  return `${marker}${value.slice(-(maximum - marker.length))}`;
}

async function readTailBounded(path) {
  if (!path) return '';
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, MAX_SOURCE_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const evidenceFromFile = await readTailBounded(process.env.DIAG_EVIDENCE_FILE);
const rawEvidence = evidenceFromFile
  || process.env.DIAG_EVIDENCE
  || 'No bounded evidence was supplied; inspect the failed step annotation.';
const evidence = truncateTail(redactSensitiveEvidence(rawEvidence));

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
