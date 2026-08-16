import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUTPUT_DIR = resolve('diagnostics/latest');
const MAX_SOURCE_BYTES = 8192;
const MAX_EVIDENCE_CHARS = 2048;
const REDACTED = '[REDACTED]';
const ALLOWED_METADATA = [
  ['event_id', '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'],
  ['event_type', '[A-Za-z][A-Za-z0-9_]{0,63}'],
  ['status', '(?:[1-5][0-9]{2}|passed|failed|failure|success|error|cancelled|skipped|timed_out|active|voided)'],
  ['trace_id', '[A-Za-z0-9][A-Za-z0-9._:-]{0,127}'],
  ['duration_ms', '[0-9]+(?:\\.[0-9]+)?'],
  ['elapsed_ms', '[0-9]+(?:\\.[0-9]+)?'],
  ['timing_ms', '[0-9]+(?:\\.[0-9]+)?'],
  ['code', '[A-Za-z][A-Za-z0-9_.-]{0,127}'],
  ['error_code', '[A-Za-z][A-Za-z0-9_.-]{0,127}'],
  ['event_code', '[A-Za-z][A-Za-z0-9_.-]{0,127}'],
  ['sqlstate', '[A-Za-z0-9]{5}'],
];

function extractAllowlistedEvidence(value) {
  const facts = new Set();
  for (const [key, allowedValue] of ALLOWED_METADATA) {
    const pattern = new RegExp(`(?:^|[\\s,{])(?:["']?${key}["']?)\\s*[:=]\\s*["']?(${allowedValue})(?=["'\\s,}]|$)`, 'gim');
    for (const match of value.matchAll(pattern)) facts.add(`${key}=${match[1]}`);
  }
  const constraintPattern = /(?:^|[\s,{])(?:["']?constraint["']?\s*[:=]\s*["']?|constraint\s+)([A-Za-z][A-Za-z0-9_]{0,127})(?=["'\s,}]|$)/gim;
  for (const match of value.matchAll(constraintPattern)) facts.add(`constraint=${match[1]}`);
  return [...facts, REDACTED].join('\n');
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
const evidence = truncateTail(extractAllowlistedEvidence(rawEvidence));

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
