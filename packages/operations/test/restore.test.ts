import { chmod, mkdtemp, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, type Writable } from 'node:stream';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createBackup } from '../src/backup.js';
import { BackupError, type MigrationHistoryFact } from '../src/contracts.js';
import { restoreBackup, type PostgresRestoreTools } from '../src/restore.js';
import {
  COMPLETE_CATALOGUE_FACTS,
  createPg16RestoreTools,
  type FixedPg16RestoreRunner,
  type PostgresBackupTools,
} from '../src/postgres-tools.js';

const roots: string[] = [];
const createdAt = new Date('2026-08-17T12:34:56.000Z');
const bundleName = 'baby-care-backup-20260817T123456Z';
const migrations: MigrationHistoryFact[] = [
  { id: 1, hash: 'a'.repeat(64), createdAt: 1_691_888_400_000 },
];

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-restore-test-')));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function backupTools(): PostgresBackupTools {
  return {
    toolMajor: async () => 16,
    sourceMajor: async () => 16,
    migrationHistory: async () => migrations,
    dump: async (destination: Writable) => {
      destination.end(Buffer.from('PGDMP fixture'));
    },
    listDump: async () => COMPLETE_CATALOGUE_FACTS,
  };
}

async function validBundle(): Promise<string> {
  const outputParent = await privateRoot();
  await createBackup({ outputParent, createdAt }, backupTools());
  return outputParent;
}

function restoreTools(order: string[], overrides: Partial<PostgresRestoreTools> = {}): PostgresRestoreTools {
  const mark = <T>(name: string, value: T) => vi.fn(async () => {
    order.push(name);
    return value;
  });
  return {
    ...backupTools(),
    sourceIdentity: mark('sourceIdentity', { systemIdentifier: 'source-system', postgresMajor: 16 }),
    targetIdentity: mark('targetIdentity', { systemIdentifier: 'target-system', postgresMajor: 16 }),
    targetState: mark('targetState', { userObjectCount: 0, migrationHistoryCount: 0 }),
    restore: vi.fn(async (source: Readable) => {
      order.push('restore');
      for await (const chunk of source) {
        // Consume the verified dump without retaining it.
        void chunk;
      }
    }),
    verifyInvariants: mark('verifyInvariants', {
      migrationsMatch: true,
      singleActiveFamily: true,
      singleActiveBaby: true,
      ownershipValid: true,
      typedDetailsValid: true,
      revisionEdgesValid: true,
      handoffsValid: true,
      remindersValid: true,
    }),
    revokeSessions: mark('revokeSessions', 2),
    probeReadModels: mark('probeReadModels', {
      summaryExecutable: true,
      timelineExecutable: true,
    }),
    ...overrides,
  };
}

describe('restoreBackup', () => {
  test('restores a verified dump larger than the former in-memory snapshot ceiling', async () => {
    const outputParent = await privateRoot();
    const chunk = Buffer.alloc(1024 * 1024);
    const largeTools = backupTools();
    largeTools.dump = async (destination: Writable) => {
      for (let index = 0; index < 256; index += 1) {
        if (!destination.write(chunk)) await once(destination, 'drain');
      }
      destination.end(Buffer.from([0]));
    };
    await createBackup({ outputParent, createdAt }, largeTools);
    const order: string[] = [];
    const tools = restoreTools(order, {
      ...largeTools,
    });

    await expect(restoreBackup({ outputParent, bundleName }, tools)).resolves.toEqual({
      code: 'restore_verified',
      revokedSessionCount: 2,
    });
    expect(await readdir(outputParent)).toEqual([bundleName]);
  }, 120_000);

  test('restores only after verification and independent empty PG16 checks', async () => {
    const outputParent = await validBundle();
    const order: string[] = [];
    const tools = restoreTools(order);

    await expect(restoreBackup({ outputParent, bundleName }, tools)).resolves.toEqual({
      code: 'restore_verified',
      revokedSessionCount: 2,
    });
    expect(order).toEqual([
      'sourceIdentity',
      'targetIdentity',
      'targetState',
      'restore',
      'verifyInvariants',
      'revokeSessions',
      'probeReadModels',
    ]);
  });

  test.each([
    ['same cluster', { targetIdentity: async () => ({ systemIdentifier: 'source-system', postgresMajor: 16 }) }, 'restore_same_cluster'],
    ['unknown source identity', { sourceIdentity: async () => ({ systemIdentifier: '', postgresMajor: 16 }) }, 'restore_identity_unknown'],
    ['wrong source major', { sourceIdentity: async () => ({ systemIdentifier: 'source-system', postgresMajor: 15 }) }, 'restore_postgres_incompatible'],
    ['wrong target major', { targetIdentity: async () => ({ systemIdentifier: 'target-system', postgresMajor: 15 }) }, 'restore_postgres_incompatible'],
    ['target objects', { targetState: async () => ({ userObjectCount: 1, migrationHistoryCount: 0 }) }, 'restore_target_not_empty'],
    ['target migration history', { targetState: async () => ({ userObjectCount: 0, migrationHistoryCount: 1 }) }, 'restore_target_not_empty'],
  ] as const)('fails closed before restore for %s', async (_label, overrides, code) => {
    const outputParent = await validBundle();
    const order: string[] = [];
    const tools = restoreTools(order, overrides);

    await expect(restoreBackup({ outputParent, bundleName }, tools)).rejects.toMatchObject({ code });
    expect(tools.restore).not.toHaveBeenCalled();
    expect(tools.verifyInvariants).not.toHaveBeenCalled();
    expect(tools.revokeSessions).not.toHaveBeenCalled();
    expect(tools.probeReadModels).not.toHaveBeenCalled();
  });

  test.each([
    ['restore', { restore: async () => { throw new Error('private database URL'); } }, 'restore_failed', ['verifyInvariants', 'revokeSessions', 'probeReadModels']],
    ['invariants', { verifyInvariants: async () => { throw new Error('row value'); } }, 'restore_invariant_failed', ['revokeSessions', 'probeReadModels']],
    ['sanitation', { revokeSessions: async () => { throw new Error('token hash'); } }, 'restore_sanitation_failed', ['probeReadModels']],
    ['read models', { probeReadModels: async () => { throw new Error('care value'); } }, 'restore_read_model_failed', []],
  ] as const)('redacts %s failure and prevents later calls', async (_label, overrides, code, forbidden) => {
    const outputParent = await validBundle();
    const order: string[] = [];
    const tools = restoreTools(order, overrides);

    let caught: unknown;
    try {
      await restoreBackup({ outputParent, bundleName }, tools);
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new BackupError(code));
    expect(String(caught)).not.toMatch(/private|token|care value/);
    for (const method of forbidden) {
      expect(tools[method as keyof PostgresRestoreTools]).not.toHaveBeenCalled();
    }
  });

  test('rejects false invariant or read-model markers', async () => {
    const outputParent = await validBundle();
    const invariantOrder: string[] = [];
    await expect(
      restoreBackup(
        { outputParent, bundleName },
        restoreTools(invariantOrder, {
          verifyInvariants: async () => ({
            migrationsMatch: false,
            singleActiveFamily: true,
            singleActiveBaby: true,
            ownershipValid: true,
            typedDetailsValid: true,
            revisionEdgesValid: true,
            handoffsValid: true,
            remindersValid: true,
          }) as never,
        }),
      ),
    ).rejects.toMatchObject({ code: 'restore_invariant_failed' });

    const probeOrder: string[] = [];
    await expect(
      restoreBackup(
        { outputParent, bundleName },
        restoreTools(probeOrder, {
          probeReadModels: async () => ({
            summaryExecutable: true,
            timelineExecutable: false,
          }) as never,
        }),
      ),
    ).rejects.toMatchObject({ code: 'restore_read_model_failed' });
  });

  test('holds the verified bundle identity across database preflight checks', async () => {
    const outputParent = await validBundle();
    const order: string[] = [];
    const restore = vi.fn();
    const bundle = join(outputParent, bundleName);
    const displaced = join(outputParent, 'verified-bundle-displaced');
    const tools = restoreTools(order, {
      async sourceIdentity() {
        await rename(bundle, displaced);
        await symlink(displaced, bundle, 'dir');
        return { systemIdentifier: 'source-system', postgresMajor: 16 };
      },
      restore,
    });

    await expect(restoreBackup({ outputParent, bundleName }, tools)).rejects.toMatchObject({
      code: 'restore_bundle_changed',
    });
    expect(restore).not.toHaveBeenCalled();
  });

  test('rejects same-inode dump mutation during database preflight', async () => {
    const outputParent = await validBundle();
    const order: string[] = [];
    const restore = vi.fn();
    const dumpPath = join(outputParent, bundleName, 'database.dump');
    const tools = restoreTools(order, {
      async sourceIdentity() {
        await writeFile(dumpPath, Buffer.from('mutated archive'), { mode: 0o600 });
        return { systemIdentifier: 'source-system', postgresMajor: 16 };
      },
      restore,
    });

    await expect(restoreBackup({ outputParent, bundleName }, tools)).rejects.toMatchObject({
      code: 'restore_bundle_changed',
    });
    expect(restore).not.toHaveBeenCalled();
  });
});

describe('createPg16RestoreTools', () => {
  function runner(overrides: Partial<FixedPg16RestoreRunner> = {}): FixedPg16RestoreRunner {
    return {
      sourceIdentity: vi.fn(async () => ({ systemIdentifier: '1001', postgresMajor: 16 })),
      targetIdentity: vi.fn(async () => ({ systemIdentifier: '2002', postgresMajor: 16 })),
      targetState: vi.fn(async () => ({ userObjectCount: 0, migrationHistoryCount: 0 })),
      restore: vi.fn(async (_request, source: Readable) => {
        for await (const chunk of source) {
          // Drain the synthetic stream.
          void chunk;
        }
      }),
      verifyInvariants: vi.fn(async () => ({
        migrationsMatch: true,
        singleActiveFamily: true,
        singleActiveBaby: true,
        ownershipValid: true,
        typedDetailsValid: true,
        revisionEdgesValid: true,
        handoffsValid: true,
        remindersValid: true,
      })),
      revokeSessions: vi.fn(async () => 2),
      ...overrides,
    };
  }

  test('exposes only fixed restore, identity, invariant and sanitation requests', async () => {
    const fixedRunner = runner();
    const tools = createPg16RestoreTools(
      backupTools(),
      fixedRunner,
      async () => ({ summaryExecutable: true, timelineExecutable: true }),
    );

    await tools.sourceIdentity();
    await tools.targetIdentity();
    await tools.targetState();
    await tools.restore(Readable.from([Buffer.from('fixture')]));
    await tools.verifyInvariants('a'.repeat(64));
    await tools.revokeSessions();
    await tools.probeReadModels();

    expect(fixedRunner.restore).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'restore',
        executable: 'pg_restore',
        args: ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname=babycare'],
      }),
      expect.anything(),
      expect.any(AbortSignal),
    );
    const restoreRequest = (fixedRunner.restore as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(JSON.stringify(restoreRequest)).not.toMatch(/--clean|--create|--role|--schema|databaseUrl/i);
    expect(fixedRunner.verifyInvariants).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'verify-invariants',
        queryId: 'restore-invariants-v1',
        isolation: 'repeatable read',
        readOnly: true,
        migrationSql: expect.stringContaining('drizzle.__drizzle_migrations'),
        invariantsSql: expect.stringContaining('typed_details_valid'),
      }),
      'a'.repeat(64),
      expect.any(AbortSignal),
    );
    expect(fixedRunner.revokeSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'revoke-sessions',
        queryId: 'revoke-restored-sessions-v1',
        transaction: true,
        sql: expect.stringMatching(/^update sessions/),
      }),
      expect.any(AbortSignal),
    );
  });

  test('rejects malformed runner results and redacts runner errors', async () => {
    const malformed = createPg16RestoreTools(
      backupTools(),
      runner({ targetState: async () => ({ userObjectCount: -1, migrationHistoryCount: 0 }) }),
      async () => ({ summaryExecutable: true, timelineExecutable: true }),
    );
    await expect(malformed.targetState()).rejects.toMatchObject({ code: 'restore_target_check_failed' });

    const leaking = createPg16RestoreTools(
      backupTools(),
      runner({ restore: async () => { throw new Error('postgres://secret@private'); } }),
      async () => ({ summaryExecutable: true, timelineExecutable: true }),
    );
    let caught: unknown;
    try {
      await leaking.restore(Readable.from([Buffer.from('fixture')]));
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new BackupError('restore_failed'));
    expect(String(caught)).not.toMatch(/secret|private/);
  });

  test('aborts a stalled restore and waits for bounded runner settlement', async () => {
    let settled = false;
    const fixedRunner = runner({
      restore: async (_request, _source, signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              settled = true;
              reject(new Error('aborted private subprocess'));
            }, 10);
          }, { once: true });
        });
      },
    });
    const tools = createPg16RestoreTools(
      backupTools(),
      fixedRunner,
      async () => ({ summaryExecutable: true, timelineExecutable: true }),
      { timeoutMs: 5 },
    );

    await expect(tools.restore(Readable.from([Buffer.from('fixture')]))).rejects.toMatchObject({
      code: 'restore_failed',
    });
    expect(settled).toBe(true);
  });
});
