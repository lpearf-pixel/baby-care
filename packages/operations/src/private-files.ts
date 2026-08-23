import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { BackupError } from './contracts.js';

const FINAL_BUNDLE_PATTERN = /^baby-care-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

function privateOwner(stat: Stats): boolean {
  return typeof process.getuid !== 'function' || stat.uid === process.getuid();
}

function privateDirectoryStat(stat: Stats): boolean {
  return (
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    privateOwner(stat) &&
    (stat.mode & 0o777) === 0o700
  );
}

async function assertNoSymlinkAncestor(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new BackupError('backup_unsafe_storage');
    }
  }
}

export function formatBackupBundleName(createdAt: Date): string {
  if (!Number.isFinite(createdAt.getTime())) {
    throw new BackupError('backup_invalid_config');
  }
  return `baby-care-backup-${createdAt
    .toISOString()
    .slice(0, 19)
    .replaceAll('-', '')
    .replaceAll(':', '')}Z`;
}

export function validateBackupBundleName(name: string): string {
  const match = FINAL_BUNDLE_PATTERN.exec(name);
  if (!match) throw new BackupError('backup_invalid_bundle');
  const [, year, month, day, hour, minute, second] = match;
  const candidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`);
  if (!Number.isFinite(candidate.getTime()) || formatBackupBundleName(candidate) !== name) {
    throw new BackupError('backup_invalid_bundle');
  }
  return name;
}

export async function assertSafePrivateParent(path: string): Promise<string> {
  try {
    if (!isAbsolute(path)) throw new BackupError('backup_unsafe_storage');
    await assertNoSymlinkAncestor(path);
    const canonical = await realpath(path);
    if (canonical !== resolve(path)) throw new BackupError('backup_unsafe_storage');
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat)) {
      throw new BackupError('backup_unsafe_storage');
    }
    if ((stat.mode & 0o777) !== 0o700) throw new BackupError('backup_unsafe_storage');
    return canonical;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function assertOutsideRepositoryRoot(
  canonicalParent: string,
  repositoryRoot: string,
): Promise<void> {
  try {
    if (!isAbsolute(repositoryRoot)) throw new BackupError('backup_unsafe_storage');
    const canonicalRepositoryRoot = await realpath(repositoryRoot);
    const relation = relative(canonicalRepositoryRoot, canonicalParent);
    if (
      relation === ''
      || (relation !== '..' && !relation.startsWith('..' + sep) && !isAbsolute(relation))
    ) {
      throw new BackupError('backup_unsafe_storage');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function assertPrivateDirectory(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!privateDirectoryStat(stat)) {
      throw new BackupError('backup_unsafe_storage');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function assertOpenDirectoryIdentity(handle: FileHandle, path: string): Promise<void> {
  try {
    const opened = await handle.stat();
    const current = await lstat(path);
    if (
      !opened.isDirectory() ||
      !privateDirectoryStat(current) ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      !privateOwner(opened) ||
      (opened.mode & 0o777) !== 0o700
    ) {
      throw new BackupError('backup_unsafe_storage');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function openPrivateDirectory(path: string): Promise<FileHandle> {
  const flags =
    constants.O_RDONLY |
    (constants.O_DIRECTORY ?? 0) |
    (constants.O_NOFOLLOW ?? 0);
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, flags);
    await assertOpenDirectoryIdentity(handle, path);
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function assertPrivateRegularFile(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      !privateOwner(stat) ||
      (stat.mode & 0o777) !== 0o600
    ) {
      throw new BackupError('backup_unsafe_storage');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function assertOpenFileIdentity(handle: FileHandle, path: string): Promise<void> {
  try {
    const opened = await handle.stat();
    const current = await lstat(path);
    if (
      !opened.isFile() ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino ||
      !privateOwner(current) ||
      (opened.mode & 0o777) !== 0o600 ||
      (current.mode & 0o777) !== 0o600
    ) {
      throw new BackupError('backup_unsafe_storage');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function createPrivateFile(path: string): Promise<FileHandle> {
  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_EXCL |
    (constants.O_NOFOLLOW ?? 0);
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, flags, 0o600);
    await assertOpenFileIdentity(handle, path);
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function openPrivateFileForRead(path: string): Promise<FileHandle> {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, flags);
    await assertOpenFileIdentity(handle, path);
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_unsafe_storage');
  }
}

export async function fsyncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await openPrivateDirectory(path);
    await fsyncDirectoryHandle(handle, path);
  } catch {
    throw new BackupError('backup_durability_failed');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function fsyncDirectoryHandle(handle: FileHandle, path: string): Promise<void> {
  try {
    await assertOpenDirectoryIdentity(handle, path);
    await handle.sync();
    await assertOpenDirectoryIdentity(handle, path);
  } catch {
    throw new BackupError('backup_durability_failed');
  }
}

export const privateBundlePaths = (bundle: string) => ({
  dump: join(bundle, 'database.dump'),
  manifest: join(bundle, 'manifest.json'),
});
