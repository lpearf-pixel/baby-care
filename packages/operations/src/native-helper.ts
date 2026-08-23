import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BackupError } from './contracts.js';

const HELPER_PATH = fileURLToPath(new URL('../.native/safe-bundle', import.meta.url));
const TEMPORARY_NAME = /^\.baby-care-backup-tmp-[A-Za-z0-9]{6}$/;
const FINAL_NAME = /^baby-care-backup-\d{8}T\d{6}Z$/;
const HELPER_OUTPUT_LIMIT = 128;

interface HelperOperation {
  operation: 'publish';
  temporaryName: string;
  finalName: string;
}

function privateOwner(uid: number): boolean {
  return typeof process.getuid !== 'function' || uid === process.getuid();
}

async function assertPrivateHelper(): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    const directory = await lstat(dirname(HELPER_PATH));
    const executable = await lstat(HELPER_PATH);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      !privateOwner(directory.uid) ||
      (directory.mode & 0o777) !== 0o700 ||
      !executable.isFile() ||
      executable.isSymbolicLink() ||
      !privateOwner(executable.uid) ||
      (executable.mode & 0o777) !== 0o700
    ) {
      throw new BackupError('backup_helper_unavailable');
    }
    handle = await open(
      HELPER_PATH,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== executable.dev ||
      opened.ino !== executable.ino ||
      !privateOwner(opened.uid) ||
      (opened.mode & 0o777) !== 0o700
    ) {
      throw new BackupError('backup_helper_unavailable');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('backup_helper_unavailable');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function validateOperation(request: HelperOperation): string[] {
  if (!TEMPORARY_NAME.test(request.temporaryName)) {
    throw new BackupError('backup_helper_protocol_failed');
  }
  if (!FINAL_NAME.test(request.finalName)) {
    throw new BackupError('backup_helper_protocol_failed');
  }
  return ['publish', request.temporaryName, request.finalName];
}

async function runHelper(
  request: HelperOperation,
  parentHandle: FileHandle,
  temporaryHandle: FileHandle,
): Promise<void> {
  const args = validateOperation(request);
  await assertPrivateHelper();
  // Do not kill this helper after publication starts; it must finish fsync or quarantine.
  const outcome = await new Promise<{ status: number | null; output: string; bounded: boolean }>(
    (resolve) => {
      let output = '';
      let bounded = true;
      let settled = false;
      const child = spawn(HELPER_PATH, args, {
        env: {},
        stdio: ['ignore', 'pipe', 'pipe', parentHandle.fd, temporaryHandle.fd],
      });
      const stdout = child.stdout;
      const stderr = child.stderr;
      if (!stdout || !stderr) {
        settled = true;
        child.kill('SIGKILL');
        resolve({ status: null, output: '', bounded: false });
        return;
      }
      stdout.on('data', (chunk: Buffer) => {
        if (output.length + chunk.byteLength > HELPER_OUTPUT_LIMIT) {
          bounded = false;
          return;
        }
        output += chunk.toString('utf8');
      });
      stderr.resume();
      child.once('error', () => {
        if (settled) return;
        settled = true;
        resolve({ status: null, output: '', bounded: false });
      });
      child.once('close', (status) => {
        if (settled) return;
        settled = true;
        resolve({ status, output, bounded });
      });
    },
  );
  if (!outcome.bounded || outcome.status === null) {
    throw new BackupError('backup_helper_unavailable');
  }
  const exact = `${outcome.status}:${outcome.output}`;
  if (exact === '0:safe_bundle_v1:published\n') return;
  if (exact === '66:safe_bundle_v1:exists\n') throw new BackupError('backup_exists');
  if (exact === '67:safe_bundle_v1:durability_failed\n') {
    throw new BackupError('backup_durability_failed');
  }
  if (exact === '69:safe_bundle_v1:unavailable\n') {
    throw new BackupError('backup_helper_unavailable');
  }
  if (exact === '65:safe_bundle_v1:unsafe\n') {
    throw new BackupError('backup_unsafe_storage');
  }
  if (exact === '70:safe_bundle_v1:operation_failed\n') {
    throw new BackupError('backup_publish_failed');
  }
  if (exact === '71:safe_bundle_v1:quarantined\n') {
    throw new BackupError('backup_cleanup_required');
  }
  if (exact === '72:safe_bundle_v1:quarantine_failed\n') {
    throw new BackupError('backup_quarantine_failed');
  }
  throw new BackupError('backup_helper_protocol_failed');
}

export async function publishPrivateBundle(
  parentHandle: FileHandle,
  temporaryHandle: FileHandle,
  temporaryName: string,
  finalName: string,
): Promise<void> {
  await runHelper(
    { operation: 'publish', temporaryName, finalName },
    parentHandle,
    temporaryHandle,
  );
}
