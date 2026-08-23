import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { createBackup } from '../src/backup.js';
import type { BackupCreateStage } from '../src/backup.js';
import { hashPassword, verifyPassword } from '../../../apps/api/src/auth/password.js';
import { createAuthService } from '../../../apps/api/src/auth/auth-service.js';
import { createDatabase } from '../../../apps/api/src/db.js';
import { verifyRestoredDatabase } from '../../../apps/api/src/operations/verify-restored-database.js';
import { canonicalMigrationFingerprint, type MigrationHistoryFact } from '../src/contracts.js';
import { restoreBackup } from '../src/restore.js';
import { createProductionOperatorDependencies, type OperatorConfig } from '../src/cli.js';
import { createComposePostgresRunners } from '../src/compose-postgres.js';
import { createDockerComposeExecutor } from '../src/compose-executor.js';
import {
  COMPLETE_CATALOGUE_FACTS,
  createPg16RestoreTools,
  createPg16BackupTools,
  type FixedPg16RestoreRunner,
  type FixedPg16Runner,
  type PostgresBackupTools,
} from '../src/postgres-tools.js';

const roots: string[] = [];
const migrations: MigrationHistoryFact[] = [
  { id: 1, hash: 'a'.repeat(64), createdAt: 1_691_888_400_000 },
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const describePg16 = process.env.BABY_CARE_PG16_INTEGRATION === '1' ? describe : describe.skip;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const postgresImage = process.env.BABY_CARE_PG16_IMAGE ?? 'postgres:16';
const syntheticPassword = 'birth-ready-test-only';
const databaseUrls = new Map<string, string>();

async function docker(args: readonly string[], input?: Readable | Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('docker', [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error('docker_test_timeout'));
    }, 180_000);
    const collect = (destination: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 32 * 1024 * 1024) {
        child.kill('SIGKILL');
        rejectPromise(new Error('docker_test_output_too_large'));
        return;
      }
      destination.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', rejectPromise);
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise(Buffer.concat(stdout));
      else rejectPromise(new Error(`docker_test_failed_${code ?? 'unknown'}_${Buffer.concat(stderr).byteLength}`));
    });
    if (input instanceof Readable) input.pipe(child.stdin);
    else child.stdin.end(input);
  });
}

async function startPg16(name: string): Promise<void> {
  await docker([
    'run', '--detach', '--rm', '--name', name,
    '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${syntheticPassword}`,
    '--env', 'POSTGRES_DB=babycare',
    postgresImage,
  ]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await docker(['exec', name, 'pg_isready', '--username=postgres', '--dbname=babycare']);
      const published = (await docker(['port', name, '5432/tcp'])).toString('utf8').trim();
      const port = published.split(':').at(-1);
      if (!port || !/^\d+$/.test(port)) throw new Error('postgres_test_port_invalid');
      databaseUrls.set(
        name,
        `postgres://postgres:${syntheticPassword}@127.0.0.1:${port}/babycare`,
      );
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
  }
  throw new Error('postgres_test_not_ready');
}

async function stopPg16(name: string): Promise<void> {
  await docker(['stop', '--time=1', name]).catch(() => undefined);
  databaseUrls.delete(name);
}

function psqlArgs(name: string): string[] {
  return [
    'exec', '--interactive',
    '--env', `PGPASSWORD=${syntheticPassword}`,
    '--env', 'PGUSER=postgres',
    '--env', 'PGDATABASE=babycare',
    name,
    'psql', '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align', '--field-separator=\t',
  ];
}

async function psql(name: string, sql: string): Promise<string> {
  return (await docker(psqlArgs(name), Buffer.from(sql))).toString('utf8').trim();
}

async function migrateAndSeed(
  name: string,
  executeSql: (target: string, sql: string) => Promise<string> = psql,
): Promise<void> {
  for (const migration of [
    '0000_m1_family_identity.sql',
    '0001_m2_care_recording.sql',
    '0002_m3_care_workspace.sql',
    '0003_m3_care_revision_versions.sql',
  ]) {
    try {
      await executeSql(name, await readFile(join(repositoryRoot, 'migrations', migration), 'utf8'));
    } catch (error) {
      throw new Error(`synthetic_seed_failed_${migration.slice(0, 4)}`, { cause: error });
    }
  }
  const tokenHash = createHash('sha256').update('restored-cookie-test-only').digest('hex');
  const passwordHash = await hashPassword('dad-test-password');
  try {
    await executeSql(name, `
    create schema drizzle;
    create table drizzle.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint not null
    );
    insert into drizzle.__drizzle_migrations (hash, created_at)
      values ('${'a'.repeat(64)}', 1691888400000);
    insert into families (id, name, timezone)
      values ('11111111-1111-4111-8111-111111111111', 'Synthetic Family', 'UTC');
    insert into babies (id, family_id, display_name)
      values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Synthetic Baby');
    insert into users (id, login_name, display_name, password_hash) values
      ('33333333-3333-4333-8333-333333333333', 'dad', 'Dad', '${passwordHash}'),
      ('55555555-5555-4555-8555-555555555555', 'mom', 'Mom', 'synthetic-mom-password-hash');
    insert into family_memberships (id, family_id, user_id, relationship, permission_level) values
      ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'dad', 'family_admin'),
      ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', 'mom', 'family_admin');
    insert into sessions (id, family_id, user_id, token_hash, expires_at, revoked_at) values
      ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', '${tokenHash}', now() + interval '1 day', null),
      ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555', '${'b'.repeat(64)}', now() + interval '1 day', now());
    insert into care_events (
      id, family_id, baby_id, actor_user_id, actor_membership_id, source, event_type,
      occurred_at, client_request_id, trace_id
    ) values (
      '99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', 'manual', 'feeding', now(),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'synthetic-trace'
    );
    insert into feeding_sessions (event_id) values ('99999999-9999-4999-8999-999999999999');
    insert into feeding_components (
      id, session_event_id, component_type, liquid_type, amount_ml, bottle_capacity_ml, occurred_at
    ) values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '99999999-9999-4999-8999-999999999999',
      'bottle', 'formula', 60, 150, now()
    );
    insert into care_events (
      id, family_id, baby_id, actor_user_id, actor_membership_id, source, event_type,
      occurred_at, status, version, client_request_id, trace_id
    ) values (
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', 'manual', 'diaper', now(), 'active', 2,
      'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd', 'synthetic-diaper-trace'
    );
    insert into diaper_events (event_id, kind)
      values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'urine');
    insert into care_event_revisions (
      id, event_id, edit_actor_user_id, edit_actor_membership_id, revision_action,
      from_version, to_version, trace_id
    ) values (
      'cececece-cece-4ece-8ece-cececececece', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
      'edit', 1, 2, 'synthetic-edit-trace'
    );
    insert into care_events (
      id, family_id, baby_id, actor_user_id, actor_membership_id, source, event_type,
      occurred_at, status, version, client_request_id, trace_id
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', 'manual', 'bathing', now(), 'voided', 2,
      'dededede-dede-4ede-8ede-dededededede', 'synthetic-void-trace'
    );
    insert into care_actions (event_id, action_type)
      values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bathing');
    insert into care_event_revisions (
      id, event_id, edit_actor_user_id, edit_actor_membership_id, revision_action,
      from_version, to_version, trace_id
    ) values (
      'dfdfdfdf-dfdf-4fdf-8fdf-dfdfdfdfdfdf', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444',
      'void', 1, 2, 'synthetic-void-revision'
    );
    insert into care_handoff_checkpoints (
      id, family_id, baby_id, actor_user_id, actor_membership_id, source,
      occurred_at, client_request_id, trace_id
    ) values (
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', 'manual', now(),
      'efefefef-efef-4fef-8fef-efefefefefef', 'synthetic-handoff-trace'
    );
    insert into care_handoff_reminder_rules (
      id, family_id, baby_id, actor_user_id, actor_membership_id,
      local_time, weekday_mask, enabled
    ) values (
      'ffffffff-ffff-4fff-8fff-ffffffffffff', '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444', '08:00', 127, true
    );
    `);
  } catch (error) {
    throw new Error('synthetic_seed_failed_data', { cause: error });
  }
}

async function containerDump(name: string, extraArgs: readonly string[] = []): Promise<Buffer> {
  return docker([
    'exec',
    '--env', `PGPASSWORD=${syntheticPassword}`,
    '--env', 'PGUSER=postgres',
    '--env', 'PGDATABASE=babycare',
    name,
    'pg_dump', '--no-owner', '--no-privileges', ...extraArgs,
  ]);
}

function stableDump(dump: Buffer<ArrayBufferLike>): string {
  return dump
    .toString('utf8')
    .split('\n')
    .filter((line) => !line.startsWith('\\restrict ') && !line.startsWith('\\unrestrict '))
    .join('\n');
}

function realBackupTools(name: string): PostgresBackupTools {
  const runner: FixedPg16Runner = {
    toolMajor: async () => 16,
    sourceMajor: async () => Number(await psql(name, `select current_setting('server_version_num')::int / 10000`)),
    migrationHistory: async () => {
      const output = await psql(name, 'select id, hash, created_at from drizzle.__drizzle_migrations order by id');
      return output.split('\n').filter(Boolean).map((line) => {
        const [id, hash, createdAt] = line.split('\t');
        return { id: Number(id), hash: hash ?? '', createdAt: Number(createdAt) };
      });
    },
    dump: async (_request, destination) => {
      destination.end(await containerDump(name, ['--format=custom']));
    },
    list: async (_request, source) => {
      const output = await docker([
        'exec', '--interactive', name, 'pg_restore', '--list',
      ], await bytes(source));
      return Readable.from([output]);
    },
  };
  return createPg16BackupTools(runner, { timeoutMs: 60_000 });
}

function parseIdentity(output: string) {
  const [systemIdentifier, postgresMajor] = output.split('\t');
  return { systemIdentifier: systemIdentifier ?? '', postgresMajor: Number(postgresMajor) };
}

function realRestoreRunner(sourceName: string, targetName: string): FixedPg16RestoreRunner {
  return {
    sourceIdentity: async (request) => parseIdentity(await psql(sourceName, request.sql)),
    targetIdentity: async (request) => parseIdentity(await psql(targetName, request.sql)),
    targetState: async (request) => {
      const [userObjectCount, migrationHistoryCount] = (await psql(targetName, request.sql)).split('\t');
      return { userObjectCount: Number(userObjectCount), migrationHistoryCount: Number(migrationHistoryCount) };
    },
    restore: async (request, source) => {
      await docker([
        'exec', '--interactive',
        '--env', `PGPASSWORD=${syntheticPassword}`,
        '--env', 'PGUSER=postgres',
        '--env', 'PGDATABASE=babycare',
        targetName,
        request.executable,
        ...request.args,
      ], source);
    },
    verifyInvariants: async (request, expectedFingerprint) => {
      const output = await psql(targetName, `
        begin isolation level repeatable read read only;
        select 'M', id, hash, created_at from (${request.migrationSql}) migrations;
        select 'I', checks.* from (${request.invariantsSql}) checks;
        commit;
      `);
      const lines = output.split('\n').filter((line) => line && line !== 'BEGIN' && line !== 'COMMIT');
      const facts = lines.filter((line) => line.startsWith('M\t')).map((line) => {
        const [, id, hash, createdAt] = line.split('\t');
        return { id: Number(id), hash: hash ?? '', createdAt: Number(createdAt) };
      });
      const invariant = lines.find((line) => line.startsWith('I\t'))?.split('\t').slice(1) ?? [];
      const flags = invariant.map((value) => value === 't');
      return {
        migrationsMatch: canonicalMigrationFingerprint(facts) === expectedFingerprint,
        singleActiveFamily: flags[0],
        singleActiveBaby: flags[1],
        ownershipValid: flags[2],
        typedDetailsValid: flags[3],
        revisionEdgesValid: flags[4],
        handoffsValid: flags[5],
        remindersValid: flags[6],
      };
    },
    revokeSessions: async (request) => {
      const output = await psql(targetName, `begin; ${request.sql}; commit;`);
      return output.split('\n').filter((line) => /^[0-9a-f-]{36}$/.test(line)).length;
    },
  };
}

async function withPg16Pair<T>(operation: (source: string, target: string) => Promise<T>): Promise<T> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const source = `baby-care-source-${suffix}`;
  const target = `baby-care-target-${suffix}`;
  await startPg16(source);
  try {
    await startPg16(target);
    try {
      return await operation(source, target);
    } finally {
      await stopPg16(target);
    }
  } finally {
    await stopPg16(source);
  }
}

async function createRealBackup(root: string, tools: PostgresBackupTools): Promise<void> {
  let lastStage: BackupCreateStage | 'before_start' = 'before_start';
  try {
    await createBackup(
      { outputParent: root, createdAt: new Date('2026-08-17T12:34:56.000Z') },
      tools,
      { onStage(stage) { lastStage = stage; } },
    );
  } catch {
    const temporary = (await readdir(root)).find((entry) => entry.startsWith('.baby-care-backup-tmp-'));
    if (temporary) {
      const bundle = join(root, temporary);
      try {
        const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8')) as {
          dump?: { bytes?: number; sha256?: string };
        };
        const dump = await readFile(join(bundle, 'database.dump'));
        if (manifest.dump?.bytes !== dump.byteLength) throw new Error('real_backup_dump_length_mismatch');
        if (manifest.dump.sha256 !== createHash('sha256').update(dump).digest('hex')) {
          throw new Error('real_backup_dump_digest_mismatch');
        }
        const facts = await tools.listDump(Readable.from([dump]));
        if (JSON.stringify(facts) !== JSON.stringify(COMPLETE_CATALOGUE_FACTS)) {
          throw new Error('real_backup_catalogue_mismatch');
        }
      } catch (diagnostic) {
        if (diagnostic instanceof Error && diagnostic.message.startsWith('real_backup_')) throw diagnostic;
        throw new Error('real_backup_artifact_invalid', { cause: diagnostic });
      }
    }
    throw new Error(`real_backup_failed_after_${lastStage}`);
  }
}

function operationsCompose(project: string): string[] {
  return [
    'compose', '--profile', 'operations', '--project-name', project,
    '--file', join(repositoryRoot, 'compose.yaml'),
    '--file', join(repositoryRoot, 'infra/backup/compose.operations.yaml'),
  ];
}

async function composeSourceSql(_target: string, sql: string): Promise<string> {
  return (await docker([
    ...operationsCompose('baby-care'),
    'exec', '--no-TTY', 'postgres', 'psql',
    '--no-psqlrc', '--set=ON_ERROR_STOP=1', '--tuples-only', '--no-align',
    '--field-separator=\t', '--username=babycare', '--dbname=babycare',
  ], Buffer.from(sql))).toString('utf8').trim();
}

async function composeSourceDump(): Promise<Buffer> {
  return docker([
    ...operationsCompose('baby-care'),
    'exec', '--no-TTY', 'postgres', 'pg_dump', '--username=babycare', '--dbname=babycare',
    '--data-only', '--column-inserts', '--no-owner', '--no-privileges',
  ]);
}

async function composeProjectObjects(project: string): Promise<string[]> {
  const containers = (await docker([
    'ps', '--all', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.ID}}',
  ])).toString('utf8').trim();
  const volumes = (await docker([
    'volume', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Name}}',
  ])).toString('utf8').trim();
  const networks = (await docker([
    'network', 'ls', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Name}}',
  ])).toString('utf8').trim();
  return [containers, volumes, networks].flatMap((value) => value.split('\n').filter(Boolean));
}

describePg16('real fixed Compose operator flow', () => {
  test('creates, verifies and practices a generated-data restore without changing source', async () => {
    expect(await composeProjectObjects('baby-care')).toEqual([]);
    let ownsSource = false;
    let stage = 'source-start';
    try {
      ownsSource = true;
      await docker([...operationsCompose('baby-care'), 'up', '--detach', '--no-deps', 'postgres']);
      stage = 'source-health';
      let consecutiveReady = 0;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await docker([
            ...operationsCompose('baby-care'), 'exec', '--no-TTY', 'postgres',
            'pg_isready', '--username=babycare', '--dbname=babycare',
          ]);
          consecutiveReady += 1;
          if (consecutiveReady === 3) break;
        } catch {
          consecutiveReady = 0;
          if (attempt === 39) throw new Error('compose_source_not_ready');
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      }
      stage = 'source-seed';
      await migrateAndSeed('postgres', composeSourceSql);
      stage = 'source-snapshot';
      const sourceBefore = await composeSourceDump();
      const root = await privateRoot();
      const config: OperatorConfig = {
        BABY_CARE_BACKUP_PARENT: root,
        BABY_CARE_BACKUP_BUNDLE: 'baby-care-backup-20260817T123456Z',
        BABY_CARE_COMPOSE_PROJECT: 'baby-care',
        BABY_CARE_RESTORE_PROJECT: 'baby-care-restore',
        BABY_CARE_SOURCE_SERVICE: 'postgres',
        BABY_CARE_RESTORE_SERVICE: 'postgres_restore',
        BABY_CARE_RESTORE_PROBE_SERVICE: 'restored_api_probe',
      };
      const diagnosticRunners = createComposePostgresRunners({
        sourceProject: 'baby-care',
        targetProject: 'baby-care-restore',
        sourceService: 'postgres',
        targetService: 'postgres_restore',
        verifierService: 'operations_verifier',
      }, createDockerComposeExecutor({ repositoryRoot }));
      const diagnosticTools = createPg16BackupTools(diagnosticRunners.backupRunner);
      stage = 'adapter-tool-major';
      await diagnosticTools.toolMajor();
      stage = 'adapter-source-major';
      await diagnosticTools.sourceMajor();
      stage = 'adapter-migrations';
      await diagnosticTools.migrationHistory();
      stage = 'adapter-dump';
      const diagnosticDump = new PassThrough();
      const diagnosticChunks: Buffer[] = [];
      diagnosticDump.on('data', (chunk) => diagnosticChunks.push(Buffer.from(chunk)));
      await diagnosticTools.dump(diagnosticDump);
      stage = 'adapter-list';
      expect(await diagnosticTools.listDump(Readable.from(diagnosticChunks))).toEqual(
        COMPLETE_CATALOGUE_FACTS,
      );
      stage = 'verifier-build';
      await docker([
        ...operationsCompose('baby-care'), 'build', 'operations_verifier', 'restored_api_probe',
      ]);
      const beforeRestoreProjects = await docker([
        'ps', '--all', '--filter', 'label=com.docker.compose.project',
        '--format', '{{.Label "com.docker.compose.project"}}',
      ]);
      const dependencies = createProductionOperatorDependencies(config, { repositoryRoot });
      stage = 'backup-create';
      await expect(dependencies.create()).resolves.toEqual({ code: 'backup_created' });
      stage = 'backup-verify';
      await expect(dependencies.verify()).resolves.toEqual({ code: 'backup_verified' });
      stage = 'restore-verify';
      await expect(dependencies.restoreVerify()).resolves.toEqual({
        code: 'restore_verified',
        revokedSessionCount: 1,
      });
      expect(stableDump(await composeSourceDump())).toBe(stableDump(sourceBefore));
      const afterRestoreProjects = await docker([
        'ps', '--all', '--filter', 'label=com.docker.compose.project',
        '--format', '{{.Label "com.docker.compose.project"}}',
      ]);
      expect(afterRestoreProjects.toString('utf8')).toBe(beforeRestoreProjects.toString('utf8'));
      const bundle = join(root, 'baby-care-backup-20260817T123456Z');
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(bundle)).mode & 0o777).toBe(0o700);
      expect((await stat(join(bundle, 'database.dump'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(bundle, 'manifest.json'))).mode & 0o777).toBe(0o600);
    } catch (error) {
      throw new Error(`compose_operator_failed_after_${stage}`, { cause: error });
    } finally {
      if (ownsSource) {
        await docker([
          ...operationsCompose('baby-care'),
          'down', '--volumes', '--remove-orphans', '--timeout', '10',
        ]).catch(() => undefined);
      }
    }
  }, 300_000);
});

describePg16('real isolated PostgreSQL 16 restore', () => {
  test('restores across distinct clusters, preserves source and changes only restored revoked_at', async () => {
    await withPg16Pair(async (source, target) => {
      await migrateAndSeed(source);
      const sourceBefore = await containerDump(source, ['--data-only', '--column-inserts']);
      const root = await privateRoot();
      const sourceTools = realBackupTools(source);
      expect(
        await sourceTools.listDump(Readable.from([await containerDump(source, ['--format=custom'])])),
      ).toEqual(COMPLETE_CATALOGUE_FACTS);
      await createRealBackup(root, sourceTools);
      let targetBeforeSanitation: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let sessionsBeforeSanitation = '';
      const runner = realRestoreRunner(source, target);
      let invariantRequest: Parameters<FixedPg16RestoreRunner['verifyInvariants']>[0] | undefined;
      let observedInvariantReport: unknown;
      const originalVerifyInvariants = runner.verifyInvariants.bind(runner);
      runner.verifyInvariants = async (request, fingerprint, signal) => {
        invariantRequest = request;
        observedInvariantReport = await originalVerifyInvariants(request, fingerprint, signal);
        return observedInvariantReport;
      };
      const originalRevoke = runner.revokeSessions.bind(runner);
      runner.revokeSessions = async (request, signal) => {
        targetBeforeSanitation = await containerDump(target, [
          '--data-only', '--column-inserts', '--exclude-table=sessions',
        ]);
        sessionsBeforeSanitation = await psql(target, `select id, family_id, user_id, token_hash,
          created_at, expires_at, last_seen_at from sessions order by id`);
        return originalRevoke(request, signal);
      };
      const tools = createPg16RestoreTools(sourceTools, runner, async () => {
        const databaseUrl = databaseUrls.get(target);
        if (!databaseUrl) throw new Error('target_database_url_missing');
        const database = createDatabase(databaseUrl);
        try {
          return await verifyRestoredDatabase(database);
        } finally {
          await database.close();
        }
      }, { timeoutMs: 60_000 });

      try {
        await expect(restoreBackup({
          outputParent: root,
          bundleName: 'baby-care-backup-20260817T123456Z',
        }, tools)).resolves.toEqual({ code: 'restore_verified', revokedSessionCount: 1 });
      } catch (error) {
        expect(observedInvariantReport).toEqual({
          migrationsMatch: true,
          singleActiveFamily: true,
          singleActiveBaby: true,
          ownershipValid: true,
          typedDetailsValid: true,
          revisionEdgesValid: true,
          handoffsValid: true,
          remindersValid: true,
        });
        throw error;
      }

      const sourceAfter = await containerDump(source, ['--data-only', '--column-inserts']);
      expect(stableDump(sourceAfter)).toBe(stableDump(sourceBefore));
      const targetAfterSanitation = await containerDump(target, [
        '--data-only', '--column-inserts', '--exclude-table=sessions',
      ]);
      expect(stableDump(targetAfterSanitation)).toBe(stableDump(targetBeforeSanitation));
      expect(await psql(target, `select id, family_id, user_id, token_hash,
        created_at, expires_at, last_seen_at from sessions order by id`)).toBe(sessionsBeforeSanitation);
      expect(await psql(target, 'select count(*) from sessions where revoked_at is null')).toBe('0');
      const rawCookieHash = createHash('sha256').update('restored-cookie-test-only').digest('hex');
      expect(await psql(target, `select count(*) from sessions
        where token_hash = '${rawCookieHash}' and revoked_at is null`)).toBe('0');
      const restoredPasswordHash = await psql(target, `select password_hash from users where login_name = 'dad'`);
      await expect(verifyPassword(restoredPasswordHash, 'dad-test-password')).resolves.toBe(true);
      const databaseUrl = databaseUrls.get(target);
      if (!databaseUrl) throw new Error('target_database_url_missing');
      const restoredDatabase = createDatabase(databaseUrl);
      try {
        const auth = createAuthService(restoredDatabase, () => new Date('2026-08-17T13:00:00.000Z'));
        await expect(auth.authenticate('restored-cookie-test-only')).resolves.toBeNull();
        await expect(auth.login('dad', 'dad-test-password', 'restore-fresh-login')).resolves.toMatchObject({
          session: { relationship: 'dad' },
        });
      } finally {
        await restoredDatabase.close();
      }

      if (!invariantRequest) throw new Error('invariant_request_missing');
      const wrongFingerprint = await originalVerifyInvariants(
        invariantRequest,
        'f'.repeat(64),
        new AbortController().signal,
      ) as { migrationsMatch: boolean };
      expect(wrongFingerprint.migrationsMatch).toBe(false);

      await psql(target, `
        update care_events set status = 'voided'
          where id = '99999999-9999-4999-8999-999999999999';
        insert into diaper_events (event_id, kind)
          values ('99999999-9999-4999-8999-999999999999', 'urine');
        set session_replication_role = replica;
        update care_handoff_checkpoints
           set actor_user_id = '55555555-5555-4555-8555-555555555555'
         where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        update care_handoff_reminder_rules
           set actor_user_id = '55555555-5555-4555-8555-555555555555'
         where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        set session_replication_role = origin;
      `);
      const corrupted = await originalVerifyInvariants(
        invariantRequest,
        canonicalMigrationFingerprint(migrations),
        new AbortController().signal,
      ) as {
        typedDetailsValid: boolean;
        revisionEdgesValid: boolean;
        handoffsValid: boolean;
        remindersValid: boolean;
      };
      expect(corrupted).toMatchObject({
        typedDetailsValid: false,
        revisionEdgesValid: false,
        handoffsValid: false,
        remindersValid: false,
      });
    });
  }, 180_000);

  test('refuses a non-empty target and leaves the source byte-identical', async () => {
    await withPg16Pair(async (source, target) => {
      await migrateAndSeed(source);
      await psql(target, `create function preexisting() returns integer
        language sql immutable as $$ select 1 $$`);
      const sourceBefore = await containerDump(source, ['--data-only', '--column-inserts']);
      const root = await privateRoot();
      const sourceTools = realBackupTools(source);
      await createRealBackup(root, sourceTools);
      const tools = createPg16RestoreTools(
        sourceTools,
        realRestoreRunner(source, target),
        async () => ({ summaryExecutable: true, timelineExecutable: true }),
        { timeoutMs: 60_000 },
      );
      await expect(restoreBackup({
        outputParent: root,
        bundleName: 'baby-care-backup-20260817T123456Z',
      }, tools)).rejects.toMatchObject({ code: 'restore_target_not_empty' });
      expect(stableDump(await containerDump(source, ['--data-only', '--column-inserts']))).toBe(
        stableDump(sourceBefore),
      );
      expect(await psql(target, `select to_regprocedure('public.preexisting()')::text`)).toBe(
        'preexisting()',
      );
    });
  }, 180_000);

  test('rolls back restored-session sanitation failure without changing source state', async () => {
    await withPg16Pair(async (source, target) => {
      await migrateAndSeed(source);
      const sourceBefore = await containerDump(source, ['--data-only', '--column-inserts']);
      const root = await privateRoot();
      const sourceTools = realBackupTools(source);
      await createRealBackup(root, sourceTools);
      const runner = realRestoreRunner(source, target);
      runner.revokeSessions = async (request) => {
        await psql(target, `begin; ${request.sql}; rollback;`);
        throw new Error('synthetic_sanitation_failure');
      };
      const tools = createPg16RestoreTools(
        sourceTools,
        runner,
        async () => ({ summaryExecutable: true, timelineExecutable: true }),
        { timeoutMs: 60_000 },
      );

      await expect(restoreBackup({
        outputParent: root,
        bundleName: 'baby-care-backup-20260817T123456Z',
      }, tools)).rejects.toMatchObject({ code: 'restore_sanitation_failed' });
      expect(await psql(target, 'select count(*) from sessions where revoked_at is null')).toBe('1');
      expect(stableDump(await containerDump(source, ['--data-only', '--column-inserts']))).toBe(
        stableDump(sourceBefore),
      );
    });
  }, 180_000);
});

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baby-care-restore-integration-')));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

interface SyntheticStore {
  careVersion: number;
  timelineCount: number;
  sessions: Array<{ id: string; revokedAt: string | null }>;
}

function sourceStore(): SyntheticStore {
  return {
    careVersion: 3,
    timelineCount: 4,
    sessions: [
      { id: 'active-session', revokedAt: null },
      { id: 'already-revoked', revokedAt: '2026-08-16T00:00:00.000Z' },
    ],
  };
}

function backupTools(source: SyntheticStore): PostgresBackupTools {
  return {
    toolMajor: async () => 16,
    sourceMajor: async () => 16,
    migrationHistory: async () => migrations,
    dump: async (destination: Writable) => {
      destination.end(Buffer.from(JSON.stringify(source)));
    },
    listDump: async () => COMPLETE_CATALOGUE_FACTS,
  };
}

async function bytes(source: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('restore library integration', () => {
  test('restores an isolated synthetic target, verifies it and changes only restored session revocation', async () => {
    const source = sourceStore();
    const sourceBefore = JSON.stringify(source);
    let target: SyntheticStore | undefined;
    let targetBeforeSanitation: SyntheticStore | undefined;
    const fixedRunner: FixedPg16RestoreRunner = {
      sourceIdentity: async () => ({ systemIdentifier: '1001', postgresMajor: 16 }),
      targetIdentity: async () => ({ systemIdentifier: '2002', postgresMajor: 16 }),
      targetState: async () => ({ userObjectCount: 0, migrationHistoryCount: 0 }),
      restore: async (_request, dump) => {
        target = JSON.parse((await bytes(dump)).toString('utf8')) as SyntheticStore;
      },
      verifyInvariants: async (_request, fingerprint) => ({
        migrationsMatch: fingerprint === canonicalMigrationFingerprint(migrations),
        singleActiveFamily: true,
        singleActiveBaby: true,
        ownershipValid: true,
        typedDetailsValid: true,
        revisionEdgesValid: true,
        handoffsValid: true,
        remindersValid: true,
      }),
      revokeSessions: async () => {
        if (!target) throw new Error('target absent');
        targetBeforeSanitation = structuredClone(target);
        let count = 0;
        target.sessions = target.sessions.map((session) => {
          if (session.revokedAt) return session;
          count += 1;
          return { ...session, revokedAt: '2026-08-17T12:34:57.000Z' };
        });
        return count;
      },
    };
    const root = await privateRoot();
    await createBackup(
      { outputParent: root, createdAt: new Date('2026-08-17T12:34:56.000Z') },
      backupTools(source),
    );
    const tools = createPg16RestoreTools(backupTools(source), fixedRunner, async () => ({
      summaryExecutable: target?.careVersion === 3,
      timelineExecutable: target?.timelineCount === 4,
    }));

    await expect(
      restoreBackup(
        { outputParent: root, bundleName: 'baby-care-backup-20260817T123456Z' },
        tools,
      ),
    ).resolves.toEqual({ code: 'restore_verified', revokedSessionCount: 1 });

    expect(JSON.stringify(source)).toBe(sourceBefore);
    expect(targetBeforeSanitation).toEqual(source);
    expect(target).toEqual({
      ...source,
      sessions: [
        { id: 'active-session', revokedAt: '2026-08-17T12:34:57.000Z' },
        { id: 'already-revoked', revokedAt: '2026-08-16T00:00:00.000Z' },
      ],
    });
  });

  test('refuses a non-empty target without reading the dump or changing the source', async () => {
    const source = sourceStore();
    const sourceBefore = JSON.stringify(source);
    const restore = vi.fn();
    const fixedRunner: FixedPg16RestoreRunner = {
      sourceIdentity: async () => ({ systemIdentifier: '1001', postgresMajor: 16 }),
      targetIdentity: async () => ({ systemIdentifier: '2002', postgresMajor: 16 }),
      targetState: async () => ({ userObjectCount: 1, migrationHistoryCount: 0 }),
      restore,
      verifyInvariants: vi.fn(),
      revokeSessions: vi.fn(),
    };
    const root = await privateRoot();
    await createBackup(
      { outputParent: root, createdAt: new Date('2026-08-17T12:34:56.000Z') },
      backupTools(source),
    );
    const tools = createPg16RestoreTools(backupTools(source), fixedRunner, async () => ({
      summaryExecutable: true,
      timelineExecutable: true,
    }));

    await expect(
      restoreBackup(
        { outputParent: root, bundleName: 'baby-care-backup-20260817T123456Z' },
        tools,
      ),
    ).rejects.toMatchObject({ code: 'restore_target_not_empty' });
    expect(restore).not.toHaveBeenCalled();
    expect(JSON.stringify(source)).toBe(sourceBefore);
  });
});
