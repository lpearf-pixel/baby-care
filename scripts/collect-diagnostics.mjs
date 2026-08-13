import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const OUTPUT_DIR = resolve('diagnostics/latest');
const MAX_SOURCE_BYTES = 8192;
const MAX_EVIDENCE_CHARS = 2048;

function truncate(value, maximum = MAX_EVIDENCE_CHARS) {
  if (value.length <= maximum) return value;
  const marker = '\n[truncated]';
  return `${value.slice(0, maximum - marker.length)}${marker}`;
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
const evidence = truncate(
  evidenceFromFile || process.env.DIAG_EVIDENCE || 'No bounded evidence was supplied; inspect the failed step annotation.',
);

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
