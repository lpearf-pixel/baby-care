import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, unlink, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import type { BackupVerifyConfig } from './backup.js';
import {
  BackupError,
  BackupManifestV1Schema,
  POSTGRES_MAJOR_VERSION,
  RestoreInvariantReportSchema,
  type BackupManifestV1,
  type RestoreInvariantReport,
} from './contracts.js';
import {
  assertOpenFileIdentity,
  assertOpenDirectoryIdentity,
  assertPrivateDirectory,
  assertPrivateRegularFile,
  assertSafePrivateParent,
  openPrivateDirectory,
  openPrivateFileForRead,
  privateBundlePaths,
  validateBackupBundleName,
} from './private-files.js';
import {
  COMPLETE_CATALOGUE_FACTS,
  type DumpCatalogueFacts,
  type PostgresBackupTools,
} from './postgres-tools.js';

const MAX_MANIFEST_BYTES = 65_536;
const SNAPSHOT_CREATE_ATTEMPTS = 4;

export interface RestoreClusterIdentity {
  systemIdentifier: string;
  postgresMajor: number;
}

export interface RestoreTargetState {
  userObjectCount: number;
  migrationHistoryCount: number;
}

export type StructuralInvariantReport = Omit<
  RestoreInvariantReport,
  'summaryExecutable' | 'timelineExecutable'
>;

export interface PostgresRestoreTools extends PostgresBackupTools {
  sourceIdentity(): Promise<RestoreClusterIdentity>;
  targetIdentity(): Promise<RestoreClusterIdentity>;
  targetState(): Promise<RestoreTargetState>;
  restore(source: Readable): Promise<void>;
  verifyInvariants(migrationFingerprint: string): Promise<StructuralInvariantReport>;
  revokeSessions(): Promise<number>;
  probeReadModels(): Promise<Pick<RestoreInvariantReport, 'summaryExecutable' | 'timelineExecutable'>>;
}

export type RestoreBackupConfig = BackupVerifyConfig;

function closed(code: string): BackupError {
  return new BackupError(code);
}

function validIdentity(identity: RestoreClusterIdentity): boolean {
  return (
    typeof identity.systemIdentifier === 'string' &&
    identity.systemIdentifier.length > 0 &&
    identity.systemIdentifier.length <= 128 &&
    !/\s/.test(identity.systemIdentifier) &&
    identity.postgresMajor === POSTGRES_MAJOR_VERSION
  );
}

function validTargetState(state: RestoreTargetState): boolean {
  return (
    Number.isSafeInteger(state.userObjectCount) &&
    state.userObjectCount === 0 &&
    Number.isSafeInteger(state.migrationHistoryCount) &&
    state.migrationHistoryCount === 0
  );
}

async function readManifest(handle: FileHandle, path: string): Promise<BackupManifestV1> {
  try {
    const stat = await handle.stat();
    if (stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) throw closed('restore_bundle_changed');
    const content = Buffer.alloc(Number(stat.size));
    const result = await handle.read(content, 0, content.byteLength, 0);
    if (result.bytesRead !== content.byteLength) throw closed('restore_bundle_changed');
    await assertOpenFileIdentity(handle, path);
    return BackupManifestV1Schema.parse(JSON.parse(content.toString('utf8')));
  } catch {
    throw closed('restore_bundle_changed');
  }
}

async function* readOpenFile(handle: FileHandle): AsyncGenerator<Buffer> {
  let position = 0;
  const buffer = Buffer.alloc(64 * 1024);
  while (true) {
    const result = await handle.read(buffer, 0, buffer.byteLength, position);
    if (result.bytesRead === 0) return;
    position += result.bytesRead;
    yield Buffer.from(buffer.subarray(0, result.bytesRead));
  }
}

async function assertAnonymousSnapshot(handle: FileHandle, expectedBytes?: number): Promise<void> {
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.nlink !== 0 ||
      (expectedBytes !== undefined && stat.size !== expectedBytes)
    ) {
      throw closed('restore_snapshot_failed');
    }
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw closed('restore_snapshot_failed');
  }
}

async function createAnonymousSnapshot(parent: string): Promise<FileHandle> {
  const parentHandle = await openPrivateDirectory(parent);
  let snapshot: FileHandle | undefined;
  try {
    for (let attempt = 0; attempt < SNAPSHOT_CREATE_ATTEMPTS; attempt += 1) {
      await assertOpenDirectoryIdentity(parentHandle, parent);
      const path = join(parent, `.baby-care-restore-snapshot-${randomBytes(16).toString('hex')}`);
      try {
        snapshot = await open(
          path,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw closed('restore_snapshot_failed');
      }
      await assertOpenFileIdentity(snapshot, path);
      await unlink(path);
      await assertAnonymousSnapshot(snapshot, 0);
      await assertOpenDirectoryIdentity(parentHandle, parent);
      return snapshot;
    }
    throw closed('restore_snapshot_failed');
  } catch (error) {
    await snapshot?.close().catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw closed('restore_snapshot_failed');
  } finally {
    await parentHandle.close().catch(() => undefined);
  }
}

async function writeSnapshot(handle: FileHandle, source: FileHandle, expectedBytes: number): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of readOpenFile(source)) {
    bytes += chunk.byteLength;
    if (bytes > expectedBytes) throw closed('restore_bundle_changed');
    hash.update(chunk);
    let offset = 0;
    while (offset < chunk.byteLength) {
      let bytesWritten: number;
      try {
        ({ bytesWritten } = await handle.write(
          chunk,
          offset,
          chunk.byteLength - offset,
          bytes - chunk.byteLength + offset,
        ));
      } catch {
        throw closed('restore_snapshot_failed');
      }
      if (bytesWritten <= 0) throw closed('restore_snapshot_failed');
      offset += bytesWritten;
    }
  }
  if (bytes !== expectedBytes) throw closed('restore_bundle_changed');
  try {
    await handle.sync();
  } catch {
    throw closed('restore_snapshot_failed');
  }
  await assertAnonymousSnapshot(handle, bytes);
  return hash.digest('hex');
}

function catalogueComplete(facts: DumpCatalogueFacts): boolean {
  return (Object.keys(COMPLETE_CATALOGUE_FACTS) as Array<keyof DumpCatalogueFacts>).every(
    (key) => facts[key] === true,
  );
}

async function openVerifiedDump(
  config: RestoreBackupConfig,
  postgresTools: PostgresRestoreTools,
): Promise<{
  bundleHandle: FileHandle;
  bundlePath: string;
  dumpHandle: FileHandle;
  dumpPath: string;
  manifestHandle: FileHandle;
  manifestPath: string;
  manifest: BackupManifestV1;
  snapshotHandle: FileHandle;
}> {
  const parent = await assertSafePrivateParent(config.outputParent);
  const bundleName = validateBackupBundleName(config.bundleName);
  const bundle = join(parent, bundleName);
  const paths = privateBundlePaths(bundle);
  let bundleHandle: FileHandle | undefined;
  let dumpHandle: FileHandle | undefined;
  let manifestHandle: FileHandle | undefined;
  let snapshotHandle: FileHandle | undefined;
  try {
    await assertPrivateDirectory(bundle);
    bundleHandle = await openPrivateDirectory(bundle);
    const entries = (await readdir(bundle)).sort();
    if (entries.length !== 2 || entries[0] !== 'database.dump' || entries[1] !== 'manifest.json') {
      throw closed('restore_bundle_changed');
    }
    await assertPrivateRegularFile(paths.manifest);
    await assertPrivateRegularFile(paths.dump);
    manifestHandle = await openPrivateFileForRead(paths.manifest);
    dumpHandle = await openPrivateFileForRead(paths.dump);
    await assertOpenDirectoryIdentity(bundleHandle, bundle);

    const manifest = await readManifest(manifestHandle, paths.manifest);
    const toolMajor = await postgresTools.toolMajor();
    if (toolMajor !== POSTGRES_MAJOR_VERSION || manifest.postgresMajor !== POSTGRES_MAJOR_VERSION) {
      throw closed('restore_postgres_incompatible');
    }
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    await assertOpenFileIdentity(manifestHandle, paths.manifest);

    snapshotHandle = await createAnonymousSnapshot(parent);
    const digest = await writeSnapshot(snapshotHandle, dumpHandle, manifest.dump.bytes);
    await assertOpenFileIdentity(dumpHandle, paths.dump);
    if (digest !== manifest.dump.sha256) {
      throw closed('restore_bundle_changed');
    }

    const catalogueSource = Readable.from(readOpenFile(snapshotHandle));
    let catalogue: DumpCatalogueFacts;
    try {
      catalogue = await postgresTools.listDump(catalogueSource);
    } finally {
      catalogueSource.destroy();
    }
    if (!catalogueComplete(catalogue) || catalogue.drizzleMigrations !== true) {
      throw closed('restore_bundle_changed');
    }
    await assertAnonymousSnapshot(snapshotHandle, manifest.dump.bytes);
    await assertOpenDirectoryIdentity(bundleHandle, bundle);
    await assertOpenFileIdentity(manifestHandle, paths.manifest);
    await assertOpenFileIdentity(dumpHandle, paths.dump);
    return {
      bundleHandle,
      bundlePath: bundle,
      dumpHandle,
      dumpPath: paths.dump,
      manifestHandle,
      manifestPath: paths.manifest,
      manifest,
      snapshotHandle,
    };
  } catch (error) {
    await snapshotHandle?.close().catch(() => undefined);
    await dumpHandle?.close().catch(() => undefined);
    await manifestHandle?.close().catch(() => undefined);
    await bundleHandle?.close().catch(() => undefined);
    if (error instanceof BackupError) throw error;
    throw closed('restore_bundle_changed');
  }
}

async function stage<T>(code: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw closed(code);
  }
}

async function assertDumpMatches(
  handle: FileHandle,
  path: string,
  manifest: BackupManifestV1,
): Promise<void> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of readOpenFile(handle)) {
    bytes += chunk.byteLength;
    if (bytes > manifest.dump.bytes) throw closed('restore_bundle_changed');
    hash.update(chunk);
  }
  await assertOpenFileIdentity(handle, path);
  if (bytes !== manifest.dump.bytes || hash.digest('hex') !== manifest.dump.sha256) {
    throw closed('restore_bundle_changed');
  }
}

export async function restoreBackup(
  config: RestoreBackupConfig,
  postgresTools: PostgresRestoreTools,
): Promise<{ code: 'restore_verified'; revokedSessionCount: number }> {
  const artifact = await openVerifiedDump(config, postgresTools);
  try {
    const source = await stage('restore_identity_unknown', () => postgresTools.sourceIdentity());
    if (!validIdentity(source)) {
      if (source.postgresMajor !== POSTGRES_MAJOR_VERSION) throw closed('restore_postgres_incompatible');
      throw closed('restore_identity_unknown');
    }
    const target = await stage('restore_identity_unknown', () => postgresTools.targetIdentity());
    if (!validIdentity(target)) {
      if (target.postgresMajor !== POSTGRES_MAJOR_VERSION) throw closed('restore_postgres_incompatible');
      throw closed('restore_identity_unknown');
    }
    if (source.systemIdentifier === target.systemIdentifier) throw closed('restore_same_cluster');

    const targetState = await stage('restore_target_check_failed', () => postgresTools.targetState());
    if (!validTargetState(targetState)) throw closed('restore_target_not_empty');

    await stage('restore_bundle_changed', async () => {
      await assertOpenDirectoryIdentity(artifact.bundleHandle, artifact.bundlePath);
      await assertOpenFileIdentity(artifact.manifestHandle, artifact.manifestPath);
      await assertDumpMatches(artifact.dumpHandle, artifact.dumpPath, artifact.manifest);
    });
    const dump = Readable.from(readOpenFile(artifact.snapshotHandle));
    try {
      await stage('restore_failed', () => postgresTools.restore(dump));
    } finally {
      dump.destroy();
    }
    await stage('restore_bundle_changed', async () => {
      await assertOpenDirectoryIdentity(artifact.bundleHandle, artifact.bundlePath);
      await assertOpenFileIdentity(artifact.manifestHandle, artifact.manifestPath);
      await assertDumpMatches(artifact.dumpHandle, artifact.dumpPath, artifact.manifest);
    });

    const structural = await stage('restore_invariant_failed', () =>
      postgresTools.verifyInvariants(artifact.manifest.migrationFingerprint),
    );
    const structuralResult = RestoreInvariantReportSchema.omit({
      summaryExecutable: true,
      timelineExecutable: true,
    }).safeParse(structural);
    if (!structuralResult.success) throw closed('restore_invariant_failed');

    const revokedSessionCount = await stage('restore_sanitation_failed', () =>
      postgresTools.revokeSessions(),
    );
    if (!Number.isSafeInteger(revokedSessionCount) || revokedSessionCount < 0) {
      throw closed('restore_sanitation_failed');
    }

    const readModels = await stage('restore_read_model_failed', () => postgresTools.probeReadModels());
    const complete = RestoreInvariantReportSchema.safeParse({ ...structuralResult.data, ...readModels });
    if (!complete.success) throw closed('restore_read_model_failed');

    return { code: 'restore_verified', revokedSessionCount };
  } finally {
    await artifact.snapshotHandle.close().catch(() => undefined);
    await artifact.dumpHandle.close().catch(() => undefined);
    await artifact.manifestHandle.close().catch(() => undefined);
    await artifact.bundleHandle.close().catch(() => undefined);
  }
}
