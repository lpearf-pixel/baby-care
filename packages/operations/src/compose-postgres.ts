import { Readable, type Writable } from 'node:stream';

import { z } from 'zod';

import { BackupError, canonicalMigrationFingerprint } from './contracts.js';
import type {
  FixedPg16RestoreRunner,
  FixedPg16Runner,
} from './postgres-tools.js';

export interface ComposeExecRequest {
  project: string;
  service: string;
  executable: string;
  args: readonly string[];
  input?: Readable;
  output?: Writable;
}

export interface ComposeExecutor {
  exec(request: ComposeExecRequest, signal: AbortSignal): Promise<Buffer>;
  lifecycle(request: ComposeLifecycleRequest, signal: AbortSignal): Promise<Buffer>;
}

export type ComposeLifecycleRequest =
  | { action: 'project-status'; project: string }
  | {
    action: 'project-object-status';
    project: string;
    objectType: 'container' | 'volume' | 'network';
  }
  | { action: 'create-restore-target'; project: string }
  | { action: 'start-restored-probe'; project: string }
  | { action: 'remove-owned-project'; project: string }
  | {
    action: 'running-service';
    project: string;
    service: 'postgres_restore' | 'operations_verifier';
  };

const ComposeRunnerConfigSchema = z
  .object({
    sourceProject: z.literal('baby-care'),
    targetProject: z.string().regex(/^baby-care-restore(?:-[a-f0-9]{24})?$/),
    sourceService: z.literal('postgres'),
    targetService: z.literal('postgres_restore'),
    verifierService: z.literal('operations_verifier'),
  })
  .strict();

export interface ComposeRunnerConfig {
  sourceProject: string;
  targetProject: string;
  sourceService: string;
  targetService: string;
  verifierService: string;
}

const PSQL_ARGS = Object.freeze([
  '--no-psqlrc',
  '--username=babycare',
  '--dbname=babycare',
  '--set=ON_ERROR_STOP=1',
  '--tuples-only',
  '--no-align',
  '--field-separator=\t',
]);

const SOURCE_MAJOR_SQL = `select (current_setting('server_version_num')::int / 10000)::int`;
const MIGRATION_HISTORY_SQL = `select id, hash, created_at
  from drizzle.__drizzle_migrations
 order by created_at, id, hash`;
const VERIFIER_ARGS = Object.freeze([
  '--filter',
  '@baby-care/api',
  'exec',
  'tsx',
  '../../packages/operations/scripts/run-restored-verifier.mts',
]);

function lines(buffer: Buffer): string[] {
  return buffer.toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean);
}

function integer(value: string | undefined, code: string): number {
  if (!value || !/^\d+$/.test(value)) throw new BackupError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new BackupError(code);
  return parsed;
}

function input(sql: string): Readable {
  return Readable.from([Buffer.from(`${sql}\n`, 'utf8')]);
}

export function createComposePostgresRunners(
  rawConfig: ComposeRunnerConfig,
  executor: ComposeExecutor,
): {
  backupRunner: FixedPg16Runner;
  restoreRunner: FixedPg16RestoreRunner;
  probeReadModels(signal: AbortSignal): Promise<{
    summaryExecutable: true;
    timelineExecutable: true;
  }>;
} {
  const parsed = ComposeRunnerConfigSchema.safeParse(rawConfig);
  if (!parsed.success) throw new BackupError('operator_config_invalid');
  const config = parsed.data;

  const exec = (
    project: string,
    service: string,
    executable: string,
    args: readonly string[],
    signal: AbortSignal,
    options: { input?: Readable; output?: Writable } = {},
  ) => executor.exec({ project, service, executable, args, ...options }, signal);

  const psql = (
    project: string,
    service: string,
    sql: string,
    signal: AbortSignal,
  ) => exec(project, service, 'psql', PSQL_ARGS, signal, { input: input(sql) });

  const backupRunner: FixedPg16Runner = {
    async toolMajor(request, signal) {
      const output = await exec(
        config.sourceProject,
        config.sourceService,
        request.executable,
        request.args,
        signal,
      );
      const match = /^pg_restore \(PostgreSQL\) (\d+)(?:\.|\s|$)/.exec(output.toString('utf8').trim());
      if (!match) throw new BackupError('backup_tool_failed');
      return integer(match[1], 'backup_tool_failed');
    },
    async sourceMajor(_request, signal) {
      return integer(lines(await psql(
        config.sourceProject,
        config.sourceService,
        SOURCE_MAJOR_SQL,
        signal,
      ))[0], 'backup_tool_failed');
    },
    async migrationHistory(_request, signal) {
      return lines(await psql(
        config.sourceProject,
        config.sourceService,
        MIGRATION_HISTORY_SQL,
        signal,
      )).map((line) => {
        const [id, hash, createdAt] = line.split('\t');
        return {
          id: integer(id, 'backup_migration_invalid'),
          hash: hash ?? '',
          createdAt: integer(createdAt, 'backup_migration_invalid'),
        };
      });
    },
    async dump(request, destination, signal) {
      const streamArgs = request.args.filter((argument) => argument !== '--file=-');
      await exec(
        config.sourceProject,
        config.sourceService,
        request.executable,
        [...streamArgs, '--username=babycare', '--dbname=babycare'],
        signal,
        { output: destination },
      );
    },
    async list(request, source, signal) {
      const output = await exec(
        config.sourceProject,
        config.sourceService,
        request.executable,
        request.args,
        signal,
        { input: source },
      );
      return Readable.from([output]);
    },
  };

  const restoreRunner: FixedPg16RestoreRunner = {
    async sourceIdentity(request, signal) {
      const [row] = lines(await psql(
        config.sourceProject,
        config.sourceService,
        request.sql,
        signal,
      ));
      const [systemIdentifier, postgresMajor] = row?.split('\t') ?? [];
      return {
        systemIdentifier: systemIdentifier ?? '',
        postgresMajor: integer(postgresMajor, 'restore_identity_unknown'),
      };
    },
    async targetIdentity(request, signal) {
      const [row] = lines(await psql(
        config.targetProject,
        config.targetService,
        request.sql,
        signal,
      ));
      const [systemIdentifier, postgresMajor] = row?.split('\t') ?? [];
      return {
        systemIdentifier: systemIdentifier ?? '',
        postgresMajor: integer(postgresMajor, 'restore_identity_unknown'),
      };
    },
    async targetState(request, signal) {
      const [row] = lines(await psql(
        config.targetProject,
        config.targetService,
        request.sql,
        signal,
      ));
      const [userObjectCount, migrationHistoryCount] = row?.split('\t') ?? [];
      return {
        userObjectCount: integer(userObjectCount, 'restore_target_check_failed'),
        migrationHistoryCount: integer(migrationHistoryCount, 'restore_target_check_failed'),
      };
    },
    async restore(request, source, signal) {
      await exec(
        config.targetProject,
        config.targetService,
        request.executable,
        [...request.args, '--username=babycare'],
        signal,
        { input: source },
      );
    },
    async verifyInvariants(request, expectedFingerprint, signal) {
      const output = await psql(
        config.targetProject,
        config.targetService,
        `begin isolation level repeatable read read only;
select 'M', id, hash, created_at from (${request.migrationSql}) migrations;
select 'I', checks.* from (${request.invariantsSql}) checks;
commit;`,
        signal,
      );
      const facts = lines(output).filter((line) => line.startsWith('M\t')).map((line) => {
        const [, id, hash, createdAt] = line.split('\t');
        return {
          id: integer(id, 'restore_invariant_failed'),
          hash: hash ?? '',
          createdAt: integer(createdAt, 'restore_invariant_failed'),
        };
      });
      const values = lines(output)
        .find((line) => line.startsWith('I\t'))
        ?.split('\t')
        .slice(1) ?? [];
      return {
        migrationsMatch: canonicalMigrationFingerprint(facts) === expectedFingerprint,
        singleActiveFamily: values[0] === 't',
        singleActiveBaby: values[1] === 't',
        ownershipValid: values[2] === 't',
        typedDetailsValid: values[3] === 't',
        revisionEdgesValid: values[4] === 't',
        handoffsValid: values[5] === 't',
        remindersValid: values[6] === 't',
        voiceCare: {
          invalidOwnershipCount: integer(values[7], 'restore_invariant_failed'),
          invalidFinalLinkCount: integer(values[8], 'restore_invariant_failed'),
          invalidProposalCount: integer(values[9], 'restore_invariant_failed'),
          activeLeaseCountBeforeSanitation: integer(values[10], 'restore_invariant_failed'),
        },
      };
    },
    async sanitizeAuthority(request, signal) {
      const output = await psql(
        config.targetProject,
        config.targetService,
        `begin; ${request.sql}; commit;`,
        signal,
      );
      const row = lines(output).find((line) => /^\d+\t\d+\t\d+\t\d+\t\d+$/.test(line));
      const values = row?.split('\t') ?? [];
      if (
        integer(values[3], 'restore_sanitation_failed') !== 0 ||
        integer(values[4], 'restore_sanitation_failed') !== 0
      ) throw new BackupError('restore_sanitation_failed');
      return {
        revokedSessionCount: integer(values[0], 'restore_sanitation_failed'),
        revokedVoiceCareLeaseCount: integer(values[1], 'restore_sanitation_failed'),
        invalidatedVoiceCareSessionCount: integer(values[2], 'restore_sanitation_failed'),
      };
    },
  };

  return {
    backupRunner,
    restoreRunner,
    async probeReadModels(signal) {
      const output = await exec(
        config.targetProject,
        config.verifierService,
        'pnpm',
        VERIFIER_ARGS,
        signal,
      );
      if (output.toString('utf8').trim() !== 'restore_read_model_verified') {
        throw new BackupError('restore_read_model_failed');
      }
      return {
        summaryExecutable: true,
        timelineExecutable: true,
        activeVoiceCareLeaseCount: 0,
        actionableVoiceCareSessionCount: 0,
      };
    },
  };
}
