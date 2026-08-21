import { constants, closeSync, openSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';

import { openPrivateDirectory } from '../src/private-files.js';
import {
  cleanupPrivateBundle,
  publishPrivateBundle,
} from '../src/native-helper.js';

const helperPath = fileURLToPath(new URL('../.native/safe-bundle', import.meta.url));
const roots: string[] = [];
const finalName = 'baby-care-backup-20260817T123456Z';

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-native-helper-')));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function privateTemporary(root: string): Promise<string> {
  const temporary = await mkdtemp(join(root, '.baby-care-backup-tmp-'));
  await chmod(temporary, 0o700);
  return temporary;
}

async function writeContractFiles(temporary: string): Promise<void> {
  await writeFile(join(temporary, 'database.dump'), 'generated', { mode: 0o600 });
  await writeFile(join(temporary, 'manifest.json'), '{}', { mode: 0o600 });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('safe-bundle native protocol', () => {
  test.each([
    ['unknown operation', ['remove', '.baby-care-backup-tmp-ABC123']],
    ['absolute path', ['cleanup', '/forbidden/.baby-care-backup-tmp-ABC123']],
    ['separator', ['cleanup', 'nested/.baby-care-backup-tmp-ABC123']],
    ['arbitrary flag', ['publish', '.baby-care-backup-tmp-ABC123', finalName, 'RENAME_SWAP']],
  ])('rejects %s with one stable closed protocol result', async (_name, args) => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(helperPath, args, {
        env: {},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd],
      });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe('safe_bundle_v1:protocol_error\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });

  test('rejects an unexpected inherited descriptor', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    const parentFd = openSync(root, constants.O_RDONLY);
    const temporaryFd = openSync(temporary, constants.O_RDONLY);
    try {
      const result = spawnSync(helperPath, ['cleanup', basename(temporary)], {
        env: {},
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', parentFd, temporaryFd, parentFd],
      });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe('safe_bundle_v1:protocol_error\n');
      expect(result.stderr).toBe('');
    } finally {
      closeSync(temporaryFd);
      closeSync(parentFd);
    }
  });
});

describe('native no-replace publication', () => {
  test('preserves a concurrently-created empty final directory', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const final = join(root, finalName);
    await mkdir(final, { mode: 0o700 });
    const concurrentIdentity = await lstat(final);
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    try {
      await expect(
        publishPrivateBundle(
          parentHandle,
          temporaryHandle,
          basename(temporary),
          finalName,
        ),
      ).rejects.toThrowError('backup_exists');
      const preservedIdentity = await lstat(final);
      expect([preservedIdentity.dev, preservedIdentity.ino]).toEqual([
        concurrentIdentity.dev,
        concurrentIdentity.ino,
      ]);
      expect((await readdir(temporary)).sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      await temporaryHandle.close();
      await parentHandle.close();
    }
  });

  test('can clean the original temporary bundle after no-replace publication is refused', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    await mkdir(join(root, finalName), { mode: 0o700 });
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    try {
      await expect(
        publishPrivateBundle(
          parentHandle,
          temporaryHandle,
          basename(temporary),
          finalName,
        ),
      ).rejects.toThrowError('backup_exists');
      await expect(
        cleanupPrivateBundle(parentHandle, temporaryHandle, basename(temporary)),
      ).resolves.toBeUndefined();
      await expect(lstat(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await temporaryHandle.close();
      await parentHandle.close();
    }
  });
});

describe('native descriptor-relative cleanup', () => {
  test('removes only a contract-shaped owned temporary bundle', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    await cleanupPrivateBundle(parentHandle, temporaryHandle, basename(temporary));
    await temporaryHandle.close();
    await parentHandle.close();
    await expect(lstat(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('preserves a replacement at the top-level temporary basename', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    const displaced = join(root, 'displaced-owned-temp');
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    await rename(temporary, displaced);
    await mkdir(temporary, { mode: 0o700 });
    await writeFile(join(temporary, 'sentinel'), 'preserve replacement', { mode: 0o600 });
    try {
      await expect(
        cleanupPrivateBundle(parentHandle, temporaryHandle, basename(temporary)),
      ).rejects.toThrowError('backup_cleanup_refused');
      expect(await readFile(join(temporary, 'sentinel'), 'utf8')).toBe('preserve replacement');
      expect((await readdir(displaced)).sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      await temporaryHandle.close();
      await parentHandle.close();
    }
  });

  test('preserves the entire bundle when a non-contract entry exists', async () => {
    const root = await privateRoot();
    const temporary = await privateTemporary(root);
    await writeContractFiles(temporary);
    await writeFile(join(temporary, 'unexpected'), 'preserve all', { mode: 0o600 });
    const parentHandle = await openPrivateDirectory(root);
    const temporaryHandle = await openPrivateDirectory(temporary);
    try {
      await expect(
        cleanupPrivateBundle(parentHandle, temporaryHandle, basename(temporary)),
      ).rejects.toThrowError('backup_cleanup_refused');
      expect((await readdir(temporary)).sort()).toEqual([
        'database.dump',
        'manifest.json',
        'unexpected',
      ]);
    } finally {
      await temporaryHandle.close();
      await parentHandle.close();
    }
  });
});
