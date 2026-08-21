import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Writable } from 'node:stream';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  BACKUP_CONTRACT_VERSION,
  BackupManifestV1Schema,
  canonicalMigrationFingerprint,
  type MigrationHistoryFact,
} from '../src/contracts.js';
import {
  createBackup,
  type BackupCreateStage,
  verifyBackup,
} from '../src/backup.js';
import {
  COMPLETE_CATALOGUE_FACTS,
  createPg16BackupTools,
  type FixedPg16Runner,
  type PostgresBackupTools,
} from '../src/postgres-tools.js';

const roots: string[] = [];
const createdAt = new Date('2026-08-17T12:34:56.000Z');
const bundleName = 'baby-care-backup-20260817T123456Z';
const dumpBytes = Buffer.from('PGDMP\u0001 generated fixture only');
const migrations: MigrationHistoryFact[] = [
  { id: 1, hash: 'a'.repeat(64), createdAt: 1_691_888_400_000 },
  { id: 2, hash: 'b'.repeat(64), createdAt: 1_692_061_200_000 },
];

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-backup-test-')));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fakeTools(overrides: Partial<PostgresBackupTools> = {}): PostgresBackupTools {
  return {
    toolMajor: async () => 16,
    sourceMajor: async () => 16,
    migrationHistory: async () => migrations,
    dump: async (destination: Writable) => {
      destination.end(dumpBytes);
    },
    listDump: async () => COMPLETE_CATALOGUE_FACTS,
    ...overrides,
  };
}

async function createValidBundle(root: string): Promise<void> {
  await createBackup({ outputParent: root, createdAt }, fakeTools());
}

describe('BackupManifestV1Schema', () => {
  const valid = {
    schemaVersion: 1,
    createdAt: '2026-08-17T12:34:56.000Z',
    postgresMajor: 16,
    dump: {
      format: 'postgres-custom',
      sha256: createHash('sha256').update(dumpBytes).digest('hex'),
      bytes: dumpBytes.byteLength,
    },
    migrationFingerprint: 'c'.repeat(64),
    backupContractVersion: 1,
  };

  test('accepts only the exact private aggregate schema', () => {
    expect(BackupManifestV1Schema.parse(valid)).toEqual(valid);
    for (const mutation of [
      { ...valid, unknown: true },
      { ...valid, schemaVersion: 2 },
      { ...valid, postgresMajor: 15 },
      { ...valid, backupContractVersion: 2 },
      { ...valid, dump: { ...valid.dump, format: 'plain' } },
      { ...valid, dump: { ...valid.dump, sha256: 'not-hex' } },
      { ...valid, dump: { ...valid.dump, bytes: 0 } },
      { ...valid, migrationFingerprint: 'not-hex' },
      { ...valid, databaseUrl: 'forbidden' },
      { ...valid, family: 'forbidden' },
      { ...valid, path: 'forbidden' },
      { ...valid, content: 'forbidden' },
      { ...valid, dump: { ...valid.dump, path: 'forbidden' } },
    ]) {
      expect(BackupManifestV1Schema.safeParse(mutation).success).toBe(false);
    }
  });

  test('canonicalizes ordered migration facts before hashing', () => {
    const canonical = JSON.stringify([
      [1, 'a'.repeat(64), 1_691_888_400_000],
      [2, 'b'.repeat(64), 1_692_061_200_000],
    ]);
    const expected = createHash('sha256').update(canonical, 'utf8').digest('hex');
    expect(canonicalMigrationFingerprint([...migrations].reverse())).toBe(expected);
  });
});

describe('createBackup', () => {
  test('streams, verifies and atomically publishes a private generic bundle', async () => {
    const root = await privateRoot();
    await expect(createBackup({ outputParent: root, createdAt }, fakeTools())).resolves.toEqual({
      code: 'backup_created',
    });

    const bundle = join(root, bundleName);
    const manifest = BackupManifestV1Schema.parse(
      JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')),
    );
    expect(await readFile(join(bundle, 'database.dump'))).toEqual(dumpBytes);
    expect(manifest).toEqual({
      schemaVersion: 1,
      createdAt: createdAt.toISOString(),
      postgresMajor: 16,
      dump: {
        format: 'postgres-custom',
        sha256: createHash('sha256').update(dumpBytes).digest('hex'),
        bytes: dumpBytes.byteLength,
      },
      migrationFingerprint: canonicalMigrationFingerprint(migrations),
      backupContractVersion: BACKUP_CONTRACT_VERSION,
    });
    expect((await lstat(bundle)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(bundle, 'database.dump'))).mode & 0o777).toBe(0o600);
    expect((await lstat(join(bundle, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect((await readdir(root)).sort()).toEqual([bundleName]);
  });

  test('refuses a pre-existing final bundle without modifying it', async () => {
    const root = await privateRoot();
    const bundle = join(root, bundleName);
    await mkdir(bundle, { mode: 0o700 });
    await writeFile(join(bundle, 'sentinel'), 'keep', { mode: 0o600 });
    await expect(createBackup({ outputParent: root, createdAt }, fakeTools())).rejects.toThrowError(
      'backup_exists',
    );
    expect(await readFile(join(bundle, 'sentinel'), 'utf8')).toBe('keep');
  });

  test('preserves an empty final directory created at the publication boundary', async () => {
    const root = await privateRoot();
    const bundle = join(root, bundleName);
    let concurrentIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        async onStage(stage) {
          if (stage !== 'after_final_absence_check') return;
          await mkdir(bundle, { mode: 0o700 });
          concurrentIdentity = await lstat(bundle);
        },
      }),
    ).rejects.toThrowError('backup_exists');
    const preservedIdentity = await lstat(bundle);
    expect(concurrentIdentity).toBeDefined();
    expect([preservedIdentity.dev, preservedIdentity.ino]).toEqual([
      concurrentIdentity?.dev,
      concurrentIdentity?.ino,
    ]);
  });

  test('fails before dumping when the source server is not PostgreSQL 16', async () => {
    const root = await privateRoot();
    const dump = vi.fn();
    await expect(
      createBackup(
        { outputParent: root, createdAt },
        fakeTools({ sourceMajor: async () => 15, dump }),
      ),
    ).rejects.toThrowError('backup_postgres_incompatible');
    expect(dump).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  test.each<BackupCreateStage>([
    'before_temp_create',
    'before_dump_fsync',
    'before_manifest_write',
    'before_manifest_fsync',
    'before_self_verify',
    'before_bundle_fsync',
    'before_parent_fsync',
    'before_rename',
  ])('leaves no final-looking bundle when %s fails', async (stage) => {
    const root = await privateRoot();
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        onStage(current) {
          if (current === stage) throw new Error(`private stage ${stage}`);
        },
      }),
    ).rejects.toThrowError(/^backup_/);
    expect(await readdir(root)).toEqual([]);
  });

  test('cleans partial state when the dump stream fails and redacts the raw error', async () => {
    const root = await privateRoot();
    const tools = fakeTools({
      dump: async () => {
        throw new Error('postgres://secret@private/database absolute/path');
      },
    });
    let caught: unknown;
    try {
      await createBackup({ outputParent: root, createdAt }, tools);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: 'backup_dump_failed', message: 'backup_dump_failed' });
    expect(String(caught)).not.toContain('secret');
    expect(await readdir(root)).toEqual([]);
  });

  test('self-verification rejects a dump changed after manifest creation', async () => {
    const root = await privateRoot();
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        async onStage(stage) {
          if (stage === 'before_self_verify') {
            const [temporary] = await readdir(root);
            if (!temporary) throw new Error('missing temporary bundle');
            await writeFile(join(root, temporary, 'database.dump'), 'changed', { mode: 0o600 });
          }
        },
      }),
    ).rejects.toThrowError('backup_integrity_failed');
    expect(await readdir(root)).toEqual([]);
  });

  test('refuses cleanup when the owned temporary path is replaced', async () => {
    const root = await privateRoot();
    const displaced = join(root, 'displaced-owned-temp');
    let replacement = '';
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        async onStage(stage) {
          if (stage !== 'before_dump_fsync') return;
          const temporary = (await readdir(root)).find((entry) =>
            entry.startsWith('.baby-care-backup-tmp-'),
          );
          if (!temporary) throw new Error('missing owned temporary bundle');
          replacement = join(root, temporary);
          await rename(replacement, displaced);
          await mkdir(replacement, { mode: 0o700 });
          await writeFile(join(replacement, 'sentinel'), 'do-not-delete', { mode: 0o600 });
          throw new Error('fault after temporary replacement');
        },
      }),
    ).rejects.toThrowError('backup_cleanup_failed');
    expect(await readFile(join(replacement, 'sentinel'), 'utf8')).toBe('do-not-delete');
    expect(await readFile(join(displaced, 'database.dump'))).toEqual(dumpBytes);
  });

  test('rejects bundle directory replacement before its durability fsync', async () => {
    const root = await privateRoot();
    const displaced = join(root, 'displaced-bundle');
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        async onStage(stage) {
          if (stage !== 'before_bundle_fsync') return;
          const temporary = (await readdir(root)).find((entry) =>
            entry.startsWith('.baby-care-backup-tmp-'),
          );
          if (!temporary) throw new Error('missing owned temporary bundle');
          const replacement = join(root, temporary);
          await rename(replacement, displaced);
          await mkdir(replacement, { mode: 0o700 });
          await link(join(displaced, 'database.dump'), join(replacement, 'database.dump'));
          await link(join(displaced, 'manifest.json'), join(replacement, 'manifest.json'));
        },
      }),
    ).rejects.toThrowError(/^backup_/);
    await expect(lstat(join(root, bundleName))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects parent replacement before parent durability fsync', async () => {
    const root = await privateRoot();
    const displacedParent = `${root}-displaced`;
    roots.push(displacedParent);
    let replacementTemp = '';
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        async onStage(stage) {
          if (stage !== 'before_parent_fsync') return;
          await rename(root, displacedParent);
          await mkdir(root, { mode: 0o700 });
          const temporary = (await readdir(displacedParent)).find((entry) =>
            entry.startsWith('.baby-care-backup-tmp-'),
          );
          if (!temporary) throw new Error('missing moved temporary bundle');
          replacementTemp = join(root, temporary);
          await mkdir(replacementTemp, { mode: 0o700 });
          await writeFile(join(replacementTemp, 'sentinel'), 'do-not-publish', { mode: 0o600 });
        },
      }),
    ).rejects.toThrowError('backup_unsafe_storage');
    expect(await readFile(join(replacementTemp, 'sentinel'), 'utf8')).toBe('do-not-publish');
  });

  test('leaves no final bundle if the native publication boundary is interrupted', async () => {
    const root = await privateRoot();
    await expect(
      createBackup({ outputParent: root, createdAt }, fakeTools(), {
        onStage(stage) {
          if (stage === 'after_final_absence_check') {
            throw new Error('native publication boundary fault');
          }
        },
      }),
    ).rejects.toThrowError(/^backup_/);
    expect(await readdir(root)).toEqual([]);
  });
});

describe('verifyBackup', () => {
  test('verifies a complete bundle without invoking dump, migrations or restore', async () => {
    const root = await privateRoot();
    await createValidBundle(root);
    const dump = vi.fn();
    const migrationHistory = vi.fn();
    const tools = fakeTools({ dump, migrationHistory });
    await expect(verifyBackup({ outputParent: root, bundleName }, tools)).resolves.toEqual({
      code: 'backup_verified',
    });
    expect(dump).not.toHaveBeenCalled();
    expect(migrationHistory).not.toHaveBeenCalled();
    expect('restore' in tools).toBe(false);
  });

  test.each([
    ['truncated dump', async (root: string) => writeFile(join(root, bundleName, 'database.dump'), 'x')],
    [
      'mode drift',
      async (root: string) => chmod(join(root, bundleName, 'database.dump'), 0o640),
    ],
    [
      'manifest unknown field',
      async (root: string) => {
        const path = join(root, bundleName, 'manifest.json');
        const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        manifest.databaseUrl = 'forbidden';
        await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
      },
    ],
  ])('rejects %s', async (_name, mutate) => {
    const root = await privateRoot();
    await createValidBundle(root);
    await mutate(root);
    await expect(verifyBackup({ outputParent: root, bundleName }, fakeTools())).rejects.toThrowError(
      /^backup_/,
    );
  });

  test.each([
    ['byte mismatch', 'bytes', dumpBytes.byteLength + 1],
    ['digest mismatch', 'sha256', '0'.repeat(64)],
  ] as const)('rejects manifest %s independently', async (_name, field, value) => {
    const root = await privateRoot();
    await createValidBundle(root);
    const path = join(root, bundleName, 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')) as {
      dump: { bytes: number; sha256: string };
    };
    if (field === 'bytes') manifest.dump.bytes = value;
    else manifest.dump.sha256 = value;
    await writeFile(path, JSON.stringify(manifest));
    await expect(verifyBackup({ outputParent: root, bundleName }, fakeTools())).rejects.toThrowError(
      'backup_integrity_failed',
    );
  });

  test('rejects symlink substitution of either bundle file', async () => {
    const root = await privateRoot();
    await createValidBundle(root);
    const external = join(root, 'external');
    await writeFile(external, dumpBytes, { mode: 0o600 });
    const dumpPath = join(root, bundleName, 'database.dump');
    await rm(dumpPath);
    await symlink(external, dumpPath, 'file');
    await expect(verifyBackup({ outputParent: root, bundleName }, fakeTools())).rejects.toThrowError(
      'backup_unsafe_storage',
    );
  });

  test('detects whole-bundle directory substitution even when files are hard-linked back', async () => {
    const root = await privateRoot();
    await createValidBundle(root);
    const bundle = join(root, bundleName);
    const displaced = join(root, 'displaced-bundle');
    let substituted = false;
    await expect(
      verifyBackup(
        { outputParent: root, bundleName },
        fakeTools({
          async listDump() {
            if (!substituted) {
              substituted = true;
              await rename(bundle, displaced);
              await mkdir(bundle, { mode: 0o700 });
              await link(join(displaced, 'database.dump'), join(bundle, 'database.dump'));
              await link(join(displaced, 'manifest.json'), join(bundle, 'manifest.json'));
            }
            return COMPLETE_CATALOGUE_FACTS;
          },
        }),
      ),
    ).rejects.toThrowError('backup_unsafe_storage');
  });

  test('rejects missing migration/catalogue facts', async () => {
    const root = await privateRoot();
    await createValidBundle(root);
    await expect(
      verifyBackup(
        { outputParent: root, bundleName },
        fakeTools({
          listDump: async () => ({ ...COMPLETE_CATALOGUE_FACTS, drizzleMigrations: false }),
        }),
      ),
    ).rejects.toThrowError('backup_catalogue_invalid');
  });

  test('rejects an incompatible PostgreSQL tool major without listing the dump', async () => {
    const root = await privateRoot();
    await createValidBundle(root);
    const listDump = vi.fn();
    await expect(
      verifyBackup(
        { outputParent: root, bundleName },
        fakeTools({ toolMajor: async () => 15, listDump }),
      ),
    ).rejects.toThrowError('backup_postgres_incompatible');
    expect(listDump).not.toHaveBeenCalled();
  });
});

describe('fixed PG16 backup adapter', () => {
  test('uses only closed dump/list actions and reduces bounded catalogue output', async () => {
    const requests: unknown[] = [];
    const runner: FixedPg16Runner = {
      toolMajor: async (request) => {
        requests.push(request);
        return 16;
      },
      sourceMajor: async (request) => {
        requests.push(request);
        return 16;
      },
      migrationHistory: async (request) => {
        requests.push(request);
        return migrations;
      },
      dump: async (request, destination) => {
        requests.push(request);
        destination.end(dumpBytes);
      },
      list: async (request) => {
        requests.push(request);
        const lines = Object.keys(COMPLETE_CATALOGUE_FACTS).map((key, index) => {
          const [schema, table] = key === 'drizzleMigrations'
            ? ['drizzle', '__drizzle_migrations']
            : ['public', key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
          return `${index + 1}; 0 0 TABLE ${schema} ${table} owner\n`;
        });
        return Readable.from(lines);
      },
    };
    const tools = createPg16BackupTools(runner, { catalogueMaxBytes: 64 * 1024, timeoutMs: 1_000 });
    const destination = new (await import('node:stream')).PassThrough();
    destination.resume();
    await tools.dump(destination);
    expect(await tools.migrationHistory()).toEqual(migrations);
    expect(await tools.listDump(Readable.from(dumpBytes))).toEqual(COMPLETE_CATALOGUE_FACTS);
    expect(await tools.toolMajor()).toBe(16);
    expect(await tools.sourceMajor()).toBe(16);

    const serialized = JSON.stringify(requests);
    expect(serialized).toContain('--format=custom');
    expect(serialized).toContain('--no-owner');
    expect(serialized).toContain('--no-privileges');
    expect(serialized).not.toMatch(/postgres:\/\/|password|secret|--table|--schema|--clean|--create/i);
  });

  test('fails closed on oversized catalogue output and raw runner errors', async () => {
    const runner: FixedPg16Runner = {
      toolMajor: async () => 16,
      sourceMajor: async () => 16,
      migrationHistory: async () => migrations,
      dump: async () => {
        throw new Error('postgres://secret@private/database');
      },
      list: async () => Readable.from(['x'.repeat(1025)]),
    };
    const tools = createPg16BackupTools(runner, { catalogueMaxBytes: 1024, timeoutMs: 1_000 });
    await expect(tools.listDump(Readable.from(dumpBytes))).rejects.toMatchObject({
      code: 'backup_catalogue_invalid',
      message: 'backup_catalogue_invalid',
    });
    const sink = new (await import('node:stream')).PassThrough();
    sink.resume();
    await expect(tools.dump(sink)).rejects.toMatchObject({
      code: 'backup_tool_failed',
      message: 'backup_tool_failed',
    });
  });

  test('bounds a stalled catalogue subprocess', async () => {
    const runner: FixedPg16Runner = {
      toolMajor: async () => 16,
      sourceMajor: async () => 16,
      migrationHistory: async () => migrations,
      dump: async (_request, destination) => {
        destination.end(dumpBytes);
      },
      list: async () => new Promise<never>(() => undefined),
    };
    const tools = createPg16BackupTools(runner, { catalogueMaxBytes: 1024, timeoutMs: 5 });
    await expect(tools.listDump(Readable.from(dumpBytes))).rejects.toMatchObject({
      code: 'backup_catalogue_invalid',
      message: 'backup_catalogue_invalid',
    });
  });

  test('does not treat TABLE DATA catalogue rows as table-definition facts', async () => {
    const runner: FixedPg16Runner = {
      toolMajor: async () => 16,
      sourceMajor: async () => 16,
      migrationHistory: async () => migrations,
      dump: async (_request, destination) => {
        destination.end(dumpBytes);
      },
      list: async () =>
        Readable.from(
          Object.values({
            ...COMPLETE_CATALOGUE_FACTS,
          }).map((_value, index) => `${index + 1}; 0 0 TABLE DATA public care_events owner\n`),
        ),
    };
    const tools = createPg16BackupTools(runner);
    const facts = await tools.listDump(Readable.from(dumpBytes));
    expect(Object.values(facts).every((present) => present === false)).toBe(true);
  });
});
