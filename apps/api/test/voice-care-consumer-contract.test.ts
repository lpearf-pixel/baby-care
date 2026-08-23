import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(repositoryRoot, 'scripts/check-voice-care-consumer.mjs');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

async function consumer(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'voice-care-consumer-'));
  roots.push(root);
  const target = join(root, 'packages/contracts/voice-care');
  await mkdir(target, { recursive: true });
  const schema = await readFile(join(repositoryRoot, 'packages/contracts/schema/voice-care-intent.v1.schema.json'));
  const corpus = await readFile(join(repositoryRoot, 'packages/contracts/fixtures/voice-care-v1.json'));
  const sourceCommit = git(repositoryRoot, 'log', '-1', '--format=%H', '--',
    'packages/contracts/schema/voice-care-intent.v1.schema.json',
    'packages/contracts/fixtures/voice-care-v1.json');
  await writeFile(join(target, 'voice-care-intent.v1.schema.json'), schema);
  await writeFile(join(target, 'voice-care-v1.json'), corpus);
  await writeFile(join(target, 'baby-care-source-commit.txt'), `${sourceCommit}\n`, 'ascii');
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.email', 'synthetic@example.invalid');
  git(root, 'config', 'user.name', 'Synthetic Test');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'synthetic contract');
  return root;
}

function run(root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 10_000 });
}

describe('read-only Voice Care consumer contract verifier', () => {
  it('accepts byte-identical tracked artifacts and source identity', async () => {
    const result = run(await consumer());
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('CONTRACT_OK schema=voice-care-intent.v1 corpus=voice-care-v1\n');
    expect(result.stderr).toBe('');
  });

  it('returns only a stable code for schema, corpus and tracked-dirty failures', async () => {
    for (const [file, code] of [
      ['voice-care-intent.v1.schema.json', 'schema_mismatch'],
      ['voice-care-v1.json', 'corpus_mismatch'],
    ] as const) {
      const root = await consumer();
      const path = join(root, 'packages/contracts/voice-care', file);
      await writeFile(path, '{}\n');
      git(root, 'add', path);
      git(root, 'commit', '--quiet', '-m', 'synthetic mismatch');
      const result = run(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe(`CONTRACT_FAIL code=${code}\n`);
      expect(result.stdout).not.toContain(root);
    }
    const dirty = await consumer();
    await writeFile(join(dirty, 'packages/contracts/voice-care/voice-care-v1.json'), '{}\n');
    expect(run(dirty).stdout).toBe('CONTRACT_FAIL code=consumer_dirty\n');
  });

  it('rejects a symlinked required artifact without revealing a path', async () => {
    const root = await consumer();
    const target = join(root, 'packages/contracts/voice-care/voice-care-v1.json');
    await rm(target);
    await symlink(join(repositoryRoot, 'packages/contracts/fixtures/voice-care-v1.json'), target);
    git(root, 'add', target);
    git(root, 'commit', '--quiet', '-m', 'synthetic symlink');
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('CONTRACT_FAIL code=consumer_missing\n');
    expect(result.stdout).not.toContain(root);
  });
});
