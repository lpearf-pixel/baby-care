import { createHash, type Hash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { chmod, lstat, mkdtemp, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';

import {
  BACKUP_CONTRACT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BackupError,
  BackupManifestV1Schema,
  POSTGRES_MAJOR_VERSION,
  canonicalMigrationFingerprint,
  type BackupManifestV1,
} from './contracts.js';
import {
  assertOpenFileIdentity,
  assertOpenDirectoryIdentity,
  assertPrivateDirectory,
  assertPrivateRegularFile,
  assertSafePrivateParent,
  createPrivateFile,
  formatBackupBundleName,
  fsyncDirectoryHandle,
  openPrivateDirectory,
  openPrivateFileForRead,
  privateBundlePaths,
  validateBackupBundleName,
} from './private-files.js';
import { cleanupPrivateBundle, publishPrivateBundle } from './native-helper.js';
import {
  COMPLETE_CATALOGUE_FACTS,
  type DumpCatalogueFacts,
  type PostgresBackupTools,
} from './postgres-tools.js';

const MAX_MANIFEST_BYTES = 65_536;

export interface BackupCreateConfig {
  outputParent: string;
  createdAt: Date;
}

export interface BackupVerifyConfig {
  outputParent: string;
  bundleName: string;
}

export type BackupCreateStage =
  | 'before_temp_create'
  | 'before_dump_fsync'
  | 'before_manifest_write'
  | 'before_manifest_fsync'
  | 'before_self_verify'
  | 'before_bundle_fsync'
  | 'before_parent_fsync'
  | 'before_rename'
  | 'after_final_absence_check';

interface BackupCreateOptions {
  onStage?: (stage: BackupCreateStage) => void | Promise<void>;
}

class HashingFileWritable extends Writable {
  readonly hash: Hash = createHash('sha256');
  bytes = 0;
  #position = 0;

  constructor(private readonly handle: FileHandle) {
    super();
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    void this.writeAll(buffer).then(() => callback(), callback);
  }

  async writeAll(buffer: Buffer): Promise<void> {
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await this.handle.write(
        buffer,
        offset,
        buffer.byteLength - offset,
        this.#position,
      );
      if (result.bytesWritten <= 0) throw new BackupError('backup_dump_failed');
      offset += result.bytesWritten;
      this.#position += result.bytesWritten;
    }
    this.hash.update(buffer);
    this.bytes += buffer.byteLength;
  }
}

function closed(error: unknown, fallback: string): BackupError {
  return error instanceof BackupError ? error : new BackupError(fallback);
}

async function stage(options: BackupCreateOptions, name: BackupCreateStage): Promise<void> {
  await options.onStage?.(name);
}

async function ensureAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new BackupError('backup_exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw closed(error, 'backup_unsafe_storage');
  }
}

async function readManifest(path: string): Promise<BackupManifestV1> {
  await assertPrivateRegularFile(path);
  const handle = await openPrivateFileForRead(path);
  try {
    const stat = await handle.stat();
    if (stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) {
      throw new BackupError('backup_manifest_invalid');
    }
    const buffer = Buffer.alloc(Number(stat.size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead !== buffer.byteLength) throw new BackupError('backup_manifest_invalid');
    await assertOpenFileIdentity(handle, path);
    return BackupManifestV1Schema.parse(JSON.parse(buffer.toString('utf8')));
  } catch (error) {
    throw closed(error, 'backup_manifest_invalid');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function digestPrivateFile(path: string): Promise<{ sha256: string; bytes: number }> {
  await assertPrivateRegularFile(path);
  const handle = await openPrivateFileForRead(path);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.byteLength;
    }
    await assertOpenFileIdentity(handle, path);
    return { sha256: hash.digest('hex'), bytes };
  } catch (error) {
    throw closed(error, 'backup_integrity_failed');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function listPrivateDump(
  path: string,
  postgresTools: PostgresBackupTools,
): Promise<DumpCatalogueFacts> {
  const handle = await openPrivateFileForRead(path);
  try {
    const source = handle.createReadStream({ autoClose: false });
    const facts = await postgresTools.listDump(source);
    source.destroy();
    await assertOpenFileIdentity(handle, path);
    return facts;
  } catch (error) {
    throw closed(error, 'backup_catalogue_invalid');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function catalogueComplete(facts: DumpCatalogueFacts): boolean {
  return (Object.keys(COMPLETE_CATALOGUE_FACTS) as Array<keyof DumpCatalogueFacts>).every(
    (key) => facts[key] === true,
  );
}

async function verifyBundleDirectory(
  bundle: string,
  postgresTools: PostgresBackupTools,
): Promise<void> {
  await assertPrivateDirectory(bundle);
  const bundleHandle = await openPrivateDirectory(bundle);
  try {
    const entries = (await readdir(bundle)).sort();
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    if (entries.length !== 2 || entries[0] !== 'database.dump' || entries[1] !== 'manifest.json') {
      throw new BackupError('backup_manifest_invalid');
    }
    const paths = privateBundlePaths(bundle);
    const manifest = await readManifest(paths.manifest);
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    const toolMajor = await postgresTools.toolMajor();
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    if (toolMajor !== POSTGRES_MAJOR_VERSION || manifest.postgresMajor !== POSTGRES_MAJOR_VERSION) {
      throw new BackupError('backup_postgres_incompatible');
    }
    const digest = await digestPrivateFile(paths.dump);
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    if (digest.bytes !== manifest.dump.bytes || digest.sha256 !== manifest.dump.sha256) {
      throw new BackupError('backup_integrity_failed');
    }
    const catalogue = await listPrivateDump(paths.dump, postgresTools);
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    if (!catalogueComplete(catalogue) || catalogue.drizzleMigrations !== true) {
      throw new BackupError('backup_catalogue_invalid');
    }
  } finally {
    await bundleHandle.close().catch(() => undefined);
  }
}

export async function createBackup(
  config: BackupCreateConfig,
  postgresTools: PostgresBackupTools,
  options: BackupCreateOptions = {},
): Promise<{ code: 'backup_created' }> {
  let parent: string | undefined;
  let temporary: string | undefined;
  let finalBundle: string | undefined;
  let parentHandle: FileHandle | undefined;
  let temporaryHandle: FileHandle | undefined;
  try {
    parent = await assertSafePrivateParent(config.outputParent);
    parentHandle = await openPrivateDirectory(parent);
    const name = formatBackupBundleName(config.createdAt);
    finalBundle = join(parent, name);
    await ensureAbsent(finalBundle);
    const toolMajor = await postgresTools.toolMajor();
    const sourceMajor = await postgresTools.sourceMajor();
    if (toolMajor !== POSTGRES_MAJOR_VERSION || sourceMajor !== POSTGRES_MAJOR_VERSION) {
      throw new BackupError('backup_postgres_incompatible');
    }
    const migrationFingerprint = canonicalMigrationFingerprint(
      await postgresTools.migrationHistory(),
    );

    await stage(options, 'before_temp_create');
    await assertOpenDirectoryIdentity(parentHandle, parent);
    temporary = await mkdtemp(join(parent, '.baby-care-backup-tmp-'));
    await chmod(temporary, 0o700);
    await assertPrivateDirectory(temporary);
    temporaryHandle = await openPrivateDirectory(temporary);
    await assertOpenDirectoryIdentity(parentHandle, parent);

    const paths = privateBundlePaths(temporary);
    const dumpHandle = await createPrivateFile(paths.dump);
    const destination = new HashingFileWritable(dumpHandle);
    try {
      try {
        await postgresTools.dump(destination);
      } catch (error) {
        destination.destroy();
        throw closed(error, 'backup_dump_failed');
      }
      if (!destination.writableEnded && !destination.destroyed) destination.end();
      await finished(destination);
      if (destination.bytes <= 0) throw new BackupError('backup_dump_failed');
      await assertOpenFileIdentity(dumpHandle, paths.dump);
      await stage(options, 'before_dump_fsync');
      await assertOpenDirectoryIdentity(parentHandle, parent);
      await assertOpenDirectoryIdentity(temporaryHandle, temporary);
      await dumpHandle.sync();
    } finally {
      await dumpHandle.close().catch(() => undefined);
    }

    const manifest: BackupManifestV1 = BackupManifestV1Schema.parse({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: config.createdAt.toISOString(),
      postgresMajor: sourceMajor,
      dump: {
        format: 'postgres-custom',
        sha256: destination.hash.digest('hex'),
        bytes: destination.bytes,
      },
      migrationFingerprint,
      backupContractVersion: BACKUP_CONTRACT_VERSION,
    });
    await stage(options, 'before_manifest_write');
    await assertOpenDirectoryIdentity(parentHandle, parent);
    await assertOpenDirectoryIdentity(temporaryHandle, temporary);
    const manifestHandle = await createPrivateFile(paths.manifest);
    try {
      await manifestHandle.writeFile(JSON.stringify(manifest), 'utf8');
      await assertOpenFileIdentity(manifestHandle, paths.manifest);
      await stage(options, 'before_manifest_fsync');
      await assertOpenDirectoryIdentity(parentHandle, parent);
      await assertOpenDirectoryIdentity(temporaryHandle, temporary);
      await manifestHandle.sync();
    } finally {
      await manifestHandle.close().catch(() => undefined);
    }

    await stage(options, 'before_self_verify');
    await assertOpenDirectoryIdentity(parentHandle, parent);
    await assertOpenDirectoryIdentity(temporaryHandle, temporary);
    await verifyBundleDirectory(temporary, postgresTools);
    await assertOpenDirectoryIdentity(temporaryHandle, temporary);
    await stage(options, 'before_bundle_fsync');
    await assertOpenDirectoryIdentity(parentHandle, parent);
    await fsyncDirectoryHandle(temporaryHandle, temporary);
    await stage(options, 'before_parent_fsync');
    await assertOpenDirectoryIdentity(temporaryHandle, temporary);
    await fsyncDirectoryHandle(parentHandle, parent);
    await stage(options, 'before_rename');
    await assertOpenDirectoryIdentity(parentHandle, parent);
    await assertOpenDirectoryIdentity(temporaryHandle, temporary);
    await ensureAbsent(finalBundle);
    await stage(options, 'after_final_absence_check');
    await publishPrivateBundle(
      parentHandle,
      temporaryHandle,
      basename(temporary),
      basename(finalBundle),
    );
    temporary = undefined;
    return { code: 'backup_created' };
  } catch (error) {
    const failure = closed(error, 'backup_failed');
    if (parent && temporary && parentHandle && temporaryHandle) {
      try {
        await cleanupPrivateBundle(parentHandle, temporaryHandle, basename(temporary));
      } catch {
        throw new BackupError('backup_cleanup_failed');
      }
    }
    throw failure;
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    await parentHandle?.close().catch(() => undefined);
  }
}

export async function verifyBackup(
  config: BackupVerifyConfig,
  postgresTools: PostgresBackupTools,
): Promise<{ code: 'backup_verified' }> {
  try {
    const parent = await assertSafePrivateParent(config.outputParent);
    const name = validateBackupBundleName(config.bundleName);
    await verifyBundleDirectory(join(parent, name), postgresTools);
    return { code: 'backup_verified' };
  } catch (error) {
    throw closed(error, 'backup_verification_failed');
  }
}
