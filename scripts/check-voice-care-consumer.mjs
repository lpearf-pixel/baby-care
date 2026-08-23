import { spawnSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRODUCER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRODUCER_SCHEMA = 'packages/contracts/schema/voice-care-intent.v1.schema.json';
const PRODUCER_CORPUS = 'packages/contracts/fixtures/voice-care-v1.json';
const CONSUMER_ROOT = 'packages/contracts/voice-care';
const CONSUMER_SCHEMA = `${CONSUMER_ROOT}/voice-care-intent.v1.schema.json`;
const CONSUMER_CORPUS = `${CONSUMER_ROOT}/voice-care-v1.json`;
const CONSUMER_SOURCE_COMMIT = `${CONSUMER_ROOT}/baby-care-source-commit.txt`;
const MAX_ARTIFACT_BYTES = 1_048_576;

class ContractFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 5_000, maxBuffer: 65_536,
  });
  if (result.status !== 0 || result.error) throw new ContractFailure('consumer_missing');
  return result.stdout.trim();
}

async function regularFile(path) {
  const value = await lstat(path).catch(() => undefined);
  if (!value?.isFile() || value.isSymbolicLink() || value.size <= 0 || value.size > MAX_ARTIFACT_BYTES) {
    throw new ContractFailure('consumer_missing');
  }
}

async function rejectSymlinkComponents(root, relativePath) {
  let current = root;
  for (const component of relativePath.split('/')) {
    current = join(current, component);
    const value = await lstat(current).catch(() => undefined);
    if (!value || value.isSymbolicLink()) throw new ContractFailure('consumer_missing');
  }
}

async function checkedConsumerRoot(input) {
  if (!isAbsolute(input)) throw new ContractFailure('consumer_missing');
  const lexical = resolve(input);
  const rootStat = await lstat(lexical).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new ContractFailure('consumer_missing');
  const canonical = await realpath(lexical).catch(() => undefined);
  if (!canonical) throw new ContractFailure('consumer_missing');
  const gitRoot = await realpath(git(canonical, ['rev-parse', '--show-toplevel']));
  if (gitRoot !== canonical) throw new ContractFailure('consumer_missing');
  if (git(canonical, ['status', '--porcelain', '--untracked-files=no'])) {
    throw new ContractFailure('consumer_dirty');
  }
  for (const path of [CONSUMER_SCHEMA, CONSUMER_CORPUS, CONSUMER_SOURCE_COMMIT]) {
    const relation = relative(canonical, join(canonical, path));
    if (relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new ContractFailure('consumer_missing');
    await rejectSymlinkComponents(canonical, path);
    await regularFile(join(canonical, path));
  }
  return canonical;
}

async function boundedRead(path) {
  await regularFile(path);
  return readFile(path);
}

async function verify(input) {
  const consumer = await checkedConsumerRoot(input);
  const producerCommit = git(PRODUCER_ROOT, [
    'log', '-1', '--format=%H', '--', PRODUCER_SCHEMA, PRODUCER_CORPUS,
  ]);
  if (!/^[a-f0-9]{40}$/.test(producerCommit)) throw new ContractFailure('consumer_missing');
  const [producerSchema, producerCorpus, consumerSchema, consumerCorpus, sourceCommit] = await Promise.all([
    boundedRead(join(PRODUCER_ROOT, PRODUCER_SCHEMA)),
    boundedRead(join(PRODUCER_ROOT, PRODUCER_CORPUS)),
    boundedRead(join(consumer, CONSUMER_SCHEMA)),
    boundedRead(join(consumer, CONSUMER_CORPUS)),
    boundedRead(join(consumer, CONSUMER_SOURCE_COMMIT)),
  ]);
  if (!producerSchema.equals(consumerSchema)) throw new ContractFailure('schema_mismatch');
  if (!producerCorpus.equals(consumerCorpus)) throw new ContractFailure('corpus_mismatch');
  if (sourceCommit.toString('ascii').trim() !== producerCommit) {
    throw new ContractFailure('schema_mismatch');
  }
}

let code;
try {
  if (process.argv.length !== 3) throw new ContractFailure('consumer_missing');
  await verify(process.argv[2]);
} catch (error) {
  code = error instanceof ContractFailure ? error.code : 'consumer_missing';
}

if (code) {
  process.stdout.write(`CONTRACT_FAIL code=${code}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('CONTRACT_OK schema=voice-care-intent.v1 corpus=voice-care-v1\n');
}
