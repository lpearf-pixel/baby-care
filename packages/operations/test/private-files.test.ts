import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';

import {
  assertPrivateDirectory,
  assertPrivateRegularFile,
  assertOpenFileIdentity,
  assertSafePrivateParent,
  createPrivateFile,
  formatBackupBundleName,
  fsyncDirectory,
  validateBackupBundleName,
} from '../src/private-files.js';

const roots: string[] = [];

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-operations-')));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('backup bundle names', () => {
  test('formats one generic UTC second-resolution name', () => {
    expect(formatBackupBundleName(new Date('2026-08-17T12:34:56.999Z'))).toBe(
      'baby-care-backup-20260817T123456Z',
    );
  });

  test.each([
    'baby-care-backup-20260817T123456Z-family',
    'baby-care-backup-20260817T123456Z/database',
    '../baby-care-backup-20260817T123456Z',
    'baby-care-backup-20260817T123456.json',
    'baby-care-backup-20261317T123456Z',
  ])('rejects non-contract bundle name %s', (name) => {
    expect(() => validateBackupBundleName(name)).toThrowError('backup_invalid_bundle');
  });
});

describe('private path validation', () => {
  test('accepts only an existing real owner-private directory', async () => {
    const root = await privateRoot();
    await expect(assertSafePrivateParent(root)).resolves.toBe(root);

    const missing = join(root, 'missing');
    await expect(assertSafePrivateParent(missing)).rejects.toThrowError('backup_unsafe_storage');

    const file = join(root, 'file');
    await writeFile(file, 'x', { mode: 0o600 });
    await expect(assertSafePrivateParent(file)).rejects.toThrowError('backup_unsafe_storage');

    const openDirectory = join(root, 'open-directory');
    await mkdir(openDirectory, { mode: 0o755 });
    await expect(assertSafePrivateParent(openDirectory)).rejects.toThrowError(
      'backup_unsafe_storage',
    );
  });

  test('rejects a symbolic link at the parent and at an ancestor', async () => {
    const root = await privateRoot();
    const target = join(root, 'target');
    await mkdir(target, { mode: 0o700 });
    const parentLink = join(root, 'parent-link');
    await symlink(target, parentLink, 'dir');
    await expect(assertSafePrivateParent(parentLink)).rejects.toThrowError('backup_unsafe_storage');

    const ancestorLink = join(root, 'ancestor-link');
    await symlink(target, ancestorLink, 'dir');
    await mkdir(join(target, 'nested'), { mode: 0o700 });
    await expect(assertSafePrivateParent(join(ancestorLink, 'nested'))).rejects.toThrowError(
      'backup_unsafe_storage',
    );
  });

  test('checks private directory and regular file modes and rejects symlinks', async () => {
    const root = await privateRoot();
    const bundle = join(root, 'baby-care-backup-20260817T123456Z');
    await mkdir(bundle, { mode: 0o700 });
    await expect(assertPrivateDirectory(bundle)).resolves.toBeUndefined();
    await chmod(bundle, 0o750);
    await expect(assertPrivateDirectory(bundle)).rejects.toThrowError('backup_unsafe_storage');

    await chmod(bundle, 0o700);
    const dump = join(bundle, 'database.dump');
    await writeFile(dump, 'dump', { mode: 0o600 });
    await expect(assertPrivateRegularFile(dump)).resolves.toBeUndefined();
    await chmod(dump, 0o640);
    await expect(assertPrivateRegularFile(dump)).rejects.toThrowError('backup_unsafe_storage');

    await chmod(dump, 0o600);
    const link = join(bundle, 'manifest.json');
    await symlink(dump, link, 'file');
    await expect(assertPrivateRegularFile(link)).rejects.toThrowError('backup_unsafe_storage');
    await expect(assertPrivateRegularFile(bundle)).rejects.toThrowError('backup_unsafe_storage');
  });

  test('rejects FIFO and Unix socket nodes where a regular file is required', async () => {
    const root = await privateRoot();
    const fifo = join(root, 'database.dump');
    const madeFifo = spawnSync('mkfifo', [fifo], { stdio: 'ignore' });
    if (madeFifo.status === 0) {
      await expect(assertPrivateRegularFile(fifo)).rejects.toThrowError('backup_unsafe_storage');
    }

    const socket = join(root, 'catalogue.socket');
    const server = createServer();
    const listenError = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      server.once('error', (error) => resolve(error));
      server.listen(socket, () => resolve(undefined));
    });
    if (listenError?.code === 'EPERM') {
      expect(listenError.code).toBe('EPERM');
      return;
    }
    if (listenError) throw listenError;
    try {
      await expect(assertPrivateRegularFile(socket)).rejects.toThrowError('backup_unsafe_storage');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe('private file primitives', () => {
  test('creates a private no-follow file and preserves the opened inode identity', async () => {
    const root = await privateRoot();
    const path = join(root, 'database.dump');
    const handle = await createPrivateFile(path);
    try {
      await handle.writeFile('private');
      await handle.sync();
    } finally {
      await handle.close();
    }

    const stat = await lstat(path);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toBe('private');

    const link = join(root, 'link');
    await symlink(path, link, 'file');
    await expect(createPrivateFile(link)).rejects.toThrowError('backup_unsafe_storage');
  });

  test('detects path substitution after a private file was opened', async () => {
    const root = await privateRoot();
    const path = join(root, 'database.dump');
    const displaced = join(root, 'displaced.dump');
    const handle = await createPrivateFile(path);
    try {
      await import('node:fs/promises').then(({ rename }) => rename(path, displaced));
      await writeFile(path, 'replacement', { mode: 0o600 });
      await expect(assertOpenFileIdentity(handle, path)).rejects.toThrowError(
        'backup_unsafe_storage',
      );
    } finally {
      await handle.close();
    }
  });

  test('fsyncs a real directory and rejects a file', async () => {
    const root = await privateRoot();
    await expect(fsyncDirectory(root)).resolves.toBeUndefined();
    const file = join(root, 'file');
    await writeFile(file, 'x', { mode: 0o600 });
    await expect(fsyncDirectory(file)).rejects.toThrowError('backup_durability_failed');
  });

  test('keeps an owner-private temporary bundle as non-final retained state', async () => {
    const root = await privateRoot();
    const temp = await mkdtemp(join(root, '.baby-care-backup-tmp-'));
    await chmod(temp, 0o700);
    await writeFile(join(temp, 'database.dump'), 'partial', { mode: 0o600 });
    await expect(assertPrivateDirectory(temp)).resolves.toBeUndefined();
    expect(() => validateBackupBundleName(basename(temp))).toThrowError('backup_invalid_bundle');
    expect(await readFile(join(temp, 'database.dump'), 'utf8')).toBe('partial');
  });

  test('uses O_NOFOLLOW when the platform exposes it', () => {
    expect(constants.O_NOFOLLOW === undefined || Number.isInteger(constants.O_NOFOLLOW)).toBe(true);
  });
});
