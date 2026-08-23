import { z } from 'zod';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, parse } from 'node:path';

import { createBackup, verifyBackup } from './backup.js';
import {
  createComposePostgresRunners,
  type ComposeExecutor,
} from './compose-postgres.js';
import {
  createDisposableComposeLifecycle,
  createDockerComposeExecutor,
  createExistingRestoreLifecycle,
} from './compose-executor.js';
import { createPg16BackupTools, createPg16RestoreTools } from './postgres-tools.js';
import {
  assertOutsideRepositoryRoot,
  assertSafePrivateParent,
  validateBackupBundleName,
} from './private-files.js';
import { restoreBackup } from './restore.js';

const OperatorConfigSchema = z
  .object({
    BABY_CARE_BACKUP_PARENT: z.string().min(1).refine((value) => (
      isAbsolute(value) && parse(value).root !== value
    )),
    BABY_CARE_BACKUP_BUNDLE: z.string().refine((value) => {
      try {
        validateBackupBundleName(value);
        return true;
      } catch {
        return false;
      }
    }),
    BABY_CARE_COMPOSE_PROJECT: z.literal('baby-care'),
    BABY_CARE_RESTORE_PROJECT: z.literal('baby-care-restore'),
    BABY_CARE_SOURCE_SERVICE: z.literal('postgres'),
    BABY_CARE_RESTORE_SERVICE: z.literal('postgres_restore'),
    BABY_CARE_RESTORE_PROBE_SERVICE: z.literal('restored_api_probe'),
  })
  .strict();

export type OperatorConfig = z.infer<typeof OperatorConfigSchema>;

const OPERATOR_CONFIG_KEYS = [
  'BABY_CARE_BACKUP_PARENT',
  'BABY_CARE_BACKUP_BUNDLE',
  'BABY_CARE_COMPOSE_PROJECT',
  'BABY_CARE_RESTORE_PROJECT',
  'BABY_CARE_SOURCE_SERVICE',
  'BABY_CARE_RESTORE_SERVICE',
  'BABY_CARE_RESTORE_PROBE_SERVICE',
] as const;

function isOperatorNamespace(key: string): boolean {
  return key.startsWith('BABY_CARE_BACKUP_') ||
    key.startsWith('BABY_CARE_COMPOSE_') ||
    key.startsWith('BABY_CARE_RESTORE_') ||
    key === 'BABY_CARE_SOURCE_SERVICE' ||
    key.startsWith('BABY_CARE_DATABASE_');
}

export function parseOperatorConfig(env: NodeJS.ProcessEnv): OperatorConfig {
  const allowed = new Set<string>(OPERATOR_CONFIG_KEYS);
  if (Object.keys(env).some((key) => isOperatorNamespace(key) && !allowed.has(key))) {
    throw Object.assign(new Error('operator_config_invalid'), { code: 'operator_config_invalid' });
  }
  const projected = Object.fromEntries(OPERATOR_CONFIG_KEYS.map((key) => [key, env[key]]));
  const parsed = OperatorConfigSchema.safeParse(projected);
  if (!parsed.success) {
    throw Object.assign(new Error('operator_config_invalid'), { code: 'operator_config_invalid' });
  }
  return parsed.data;
}

export interface OperatorDependencies {
  create(): Promise<{ code: 'backup_created' }>;
  verify(): Promise<{ code: 'backup_verified' }>;
  restore(): Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;
  restoreVerify(): Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;
}

export interface OperatorCliOptions {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  dependencies: OperatorDependencies;
  writeStdout(value: string): void;
  writeStderr(value: string): void;
}

const COMMANDS = ['backup:create', 'backup:verify', 'backup:restore', 'backup:restore-verify'] as const;
type OperatorCommand = (typeof COMMANDS)[number];

const HELP = `Baby Care private backup operations

Commands:
  backup:create
  backup:verify
  backup:restore
  backup:restore-verify

Configuration keys:
  BABY_CARE_BACKUP_PARENT
  BABY_CARE_BACKUP_BUNDLE
  BABY_CARE_COMPOSE_PROJECT
  BABY_CARE_RESTORE_PROJECT
  BABY_CARE_SOURCE_SERVICE
  BABY_CARE_RESTORE_SERVICE
  BABY_CARE_RESTORE_PROBE_SERVICE
`;

const ALLOWED_FAILURE_CODES = new Set([
  'backup_catalogue_invalid',
  'backup_cleanup_required',
  'backup_dump_failed',
  'backup_durability_failed',
  'backup_exists',
  'backup_failed',
  'backup_helper_protocol_failed',
  'backup_helper_unavailable',
  'backup_integrity_failed',
  'backup_invalid_bundle',
  'backup_invalid_config',
  'backup_manifest_invalid',
  'backup_migration_invalid',
  'backup_postgres_incompatible',
  'backup_publish_failed',
  'backup_quarantine_failed',
  'backup_tool_failed',
  'backup_unsafe_storage',
  'backup_verification_failed',
  'restore_bundle_changed',
  'restore_failed',
  'restore_identity_unknown',
  'restore_invalid_config',
  'restore_invariant_failed',
  'restore_postgres_incompatible',
  'restore_read_model_failed',
  'restore_same_cluster',
  'restore_sanitation_failed',
  'restore_snapshot_failed',
  'restore_target_check_failed',
  'restore_target_not_empty',
  'operator_process_failed',
]);

const BackupCreatedResultSchema = z.object({ code: z.literal('backup_created') }).strict();
const BackupVerifiedResultSchema = z.object({ code: z.literal('backup_verified') }).strict();
const RestoreVerifiedResultSchema = z.object({
  code: z.literal('restore_verified'),
  revokedSessionCount: z.number().int().nonnegative().safe(),
}).strict();
const ReadModelReportSchema = z.object({
  summaryExecutable: z.literal(true),
  timelineExecutable: z.literal(true),
}).strict();

function commandFrom(argv: readonly string[]): OperatorCommand | null {
  if (argv.length !== 1) return null;
  const candidate = argv[0];
  return COMMANDS.find((command) => command === candidate) ?? null;
}

function failureCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === 'string' && ALLOWED_FAILURE_CODES.has(code) ? code : 'operator_failed';
}

export async function runOperatorCli(options: OperatorCliOptions): Promise<number> {
  if (options.argv.length === 2 && options.argv[1] === '--help' && COMMANDS.includes(options.argv[0] as OperatorCommand)) {
    options.writeStdout(HELP);
    return 0;
  }
  const command = commandFrom(options.argv);
  if (!command) {
    options.writeStderr('operator_command_invalid\n');
    return 2;
  }
  try {
    parseOperatorConfig(options.env);
  } catch {
    options.writeStderr('operator_config_invalid\n');
    return 2;
  }
  try {
    const result = command === 'backup:create'
      ? BackupCreatedResultSchema.parse(await options.dependencies.create())
      : command === 'backup:verify'
        ? BackupVerifiedResultSchema.parse(await options.dependencies.verify())
        : command === 'backup:restore'
          ? RestoreVerifiedResultSchema.parse(await options.dependencies.restore())
          : RestoreVerifiedResultSchema.parse(await options.dependencies.restoreVerify());
    options.writeStdout(`${result.code}\n`);
    return 0;
  } catch (error) {
    options.writeStderr(`${failureCode(error)}\n`);
    return 1;
  }
}

export async function runDisposableRestore(options: {
  createTarget(): Promise<void>;
  waitForTarget(): Promise<void>;
  restore(): Promise<{
    code: 'restore_verified';
    revokedSessionCount: number;
  }>;
  startProbe(): Promise<void>;
  executeProbe(): Promise<{ summaryExecutable: true; timelineExecutable: true }>;
  teardown(): Promise<void>;
}): Promise<{ code: 'restore_verified'; revokedSessionCount: number }> {
  try {
    await options.createTarget();
    await options.waitForTarget();
    const result = await options.restore();
    await options.startProbe();
    const probe = await options.executeProbe();
    if (!ReadModelReportSchema.safeParse(probe).success) {
      throw Object.assign(new Error('restore_read_model_failed'), { code: 'restore_read_model_failed' });
    }
    return result;
  } finally {
    await options.teardown();
  }
}

export async function runExistingTargetRestore(options: {
  assertTargetRunning(): Promise<void>;
  restore(): Promise<{ code: 'restore_verified'; revokedSessionCount: number }>;
}): Promise<{ code: 'restore_verified'; revokedSessionCount: number }> {
  await options.assertTargetRunning();
  return options.restore();
}

export function createProductionOperatorDependencies(
  config: OperatorConfig,
  options: { repositoryRoot?: string; executor?: ComposeExecutor } = {},
): OperatorDependencies {
  const repositoryRoot = options.repositoryRoot ?? fileURLToPath(new URL('../../..', import.meta.url));
  const executor = options.executor ?? createDockerComposeExecutor({ repositoryRoot });
  const baseRunnerConfig = {
    sourceProject: config.BABY_CARE_COMPOSE_PROJECT,
    targetProject: config.BABY_CARE_RESTORE_PROJECT,
    sourceService: config.BABY_CARE_SOURCE_SERVICE,
    targetService: config.BABY_CARE_RESTORE_SERVICE,
    verifierService: 'operations_verifier' as const,
  };
  const normalRunners = createComposePostgresRunners(baseRunnerConfig, executor);
  const backupTools = createPg16BackupTools(normalRunners.backupRunner);
  const normalRestoreTools = createPg16RestoreTools(
    backupTools,
    normalRunners.restoreRunner,
    normalRunners.probeReadModels,
  );
  const bundle = {
    outputParent: config.BABY_CARE_BACKUP_PARENT,
    bundleName: config.BABY_CARE_BACKUP_BUNDLE,
    repositoryRoot,
  };
  const compactTimestamp = config.BABY_CARE_BACKUP_BUNDLE.slice(
    'baby-care-backup-'.length,
    -1,
  );
  const createdAt = new Date(
    `${compactTimestamp.slice(0, 4)}-${compactTimestamp.slice(4, 6)}-${compactTimestamp.slice(6, 8)}` +
    `T${compactTimestamp.slice(9, 11)}:${compactTimestamp.slice(11, 13)}:${compactTimestamp.slice(13, 15)}.000Z`,
  );

  const preflightStorage = async () => {
    const canonicalParent = await assertSafePrivateParent(bundle.outputParent);
    await assertOutsideRepositoryRoot(canonicalParent, bundle.repositoryRoot);
  };

  return {
    create: async () => {
      await preflightStorage();
      return createBackup({
        outputParent: bundle.outputParent,
        createdAt,
        repositoryRoot: bundle.repositoryRoot,
      }, backupTools);
    },
    verify: async () => {
      await preflightStorage();
      return verifyBackup(bundle, backupTools);
    },
    restore: async () => {
      await preflightStorage();
      const lifecycle = createExistingRestoreLifecycle(executor);
      return runExistingTargetRestore({
        assertTargetRunning: lifecycle.assertTargetRunning,
        restore: () => restoreBackup(bundle, normalRestoreTools),
      });
    },
    restoreVerify: async () => {
      await preflightStorage();
      const lifecycle = createDisposableComposeLifecycle(executor);
      const disposableRunners = createComposePostgresRunners({
        ...baseRunnerConfig,
        targetProject: lifecycle.project,
      }, executor);
      const disposableTools = createPg16RestoreTools(
        backupTools,
        disposableRunners.restoreRunner,
        disposableRunners.probeReadModels,
      );
      return runDisposableRestore({
        createTarget: lifecycle.createTarget,
        waitForTarget: lifecycle.waitForTarget,
        restore: () => restoreBackup(bundle, disposableTools),
        startProbe: lifecycle.startProbe,
        executeProbe: lifecycle.executeProbe,
        teardown: lifecycle.teardown,
      });
    },
  };
}

function lazyProductionDependencies(env: NodeJS.ProcessEnv): OperatorDependencies {
  let current: OperatorDependencies | undefined;
  const get = () => {
    current ??= createProductionOperatorDependencies(parseOperatorConfig(env));
    return current;
  };
  return {
    create: () => get().create(),
    verify: () => get().verify(),
    restore: () => get().restore(),
    restoreVerify: () => get().restoreVerify(),
  };
}

async function main(): Promise<void> {
  process.exitCode = await runOperatorCli({
    argv: process.argv.slice(2),
    env: process.env,
    dependencies: lazyProductionDependencies(process.env),
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
  });
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await main();
}
