import type { Readable, Writable } from 'node:stream';

import { z } from 'zod';

import {
  BackupError,
  MigrationHistoryFactSchema,
  POSTGRES_MAJOR_VERSION,
  RestoreInvariantReportSchema,
  type MigrationHistoryFact,
} from './contracts.js';
import type {
  PostgresRestoreTools,
  RestoreClusterIdentity,
  RestoreTargetState,
  StructuralInvariantReport,
} from './restore.js';

export const REQUIRED_CATALOGUE_RELATIONS = {
  families: ['public', 'families'],
  users: ['public', 'users'],
  familyMemberships: ['public', 'family_memberships'],
  babies: ['public', 'babies'],
  sessions: ['public', 'sessions'],
  auditEvents: ['public', 'audit_events'],
  careEvents: ['public', 'care_events'],
  feedingSessions: ['public', 'feeding_sessions'],
  feedingComponents: ['public', 'feeding_components'],
  diaperEvents: ['public', 'diaper_events'],
  sleepIntervals: ['public', 'sleep_intervals'],
  careActions: ['public', 'care_actions'],
  measurements: ['public', 'measurements'],
  careEventRevisions: ['public', 'care_event_revisions'],
  careHandoffCheckpoints: ['public', 'care_handoff_checkpoints'],
  careHandoffReminderRules: ['public', 'care_handoff_reminder_rules'],
  drizzleMigrations: ['drizzle', '__drizzle_migrations'],
} as const;

export type CatalogueFactName = keyof typeof REQUIRED_CATALOGUE_RELATIONS;
export type DumpCatalogueFacts = Record<CatalogueFactName, boolean>;

export const COMPLETE_CATALOGUE_FACTS = Object.freeze(
  Object.fromEntries(Object.keys(REQUIRED_CATALOGUE_RELATIONS).map((key) => [key, true])) as {
    readonly [Key in CatalogueFactName]: true;
  },
);

export interface PostgresBackupTools {
  toolMajor(): Promise<number>;
  sourceMajor(): Promise<number>;
  migrationHistory(): Promise<readonly MigrationHistoryFact[]>;
  dump(destination: Writable): Promise<void>;
  listDump(source: Readable): Promise<DumpCatalogueFacts>;
}

const TOOL_MAJOR_REQUEST = Object.freeze({
  action: 'tool-major' as const,
  executable: 'pg_restore' as const,
  args: Object.freeze(['--version']),
});
const MIGRATION_HISTORY_REQUEST = Object.freeze({
  action: 'migration-history' as const,
  executable: 'psql' as const,
  args: Object.freeze(['--no-psqlrc', '--no-align', '--tuples-only']),
  queryId: 'drizzle-migration-history-v1' as const,
});
const SOURCE_MAJOR_REQUEST = Object.freeze({
  action: 'source-major' as const,
  executable: 'psql' as const,
  args: Object.freeze(['--no-psqlrc', '--no-align', '--tuples-only']),
  queryId: 'source-server-major-v1' as const,
});
const DUMP_REQUEST = Object.freeze({
  action: 'dump' as const,
  executable: 'pg_dump' as const,
  args: Object.freeze(['--format=custom', '--no-owner', '--no-privileges', '--file=-']),
});
const LIST_REQUEST = Object.freeze({
  action: 'list' as const,
  executable: 'pg_restore' as const,
  args: Object.freeze(['--list']),
});

export interface FixedPg16Runner {
  toolMajor(request: typeof TOOL_MAJOR_REQUEST, signal: AbortSignal): Promise<number>;
  sourceMajor(request: typeof SOURCE_MAJOR_REQUEST, signal: AbortSignal): Promise<number>;
  migrationHistory(
    request: typeof MIGRATION_HISTORY_REQUEST,
    signal: AbortSignal,
  ): Promise<unknown>;
  dump(request: typeof DUMP_REQUEST, destination: Writable, signal: AbortSignal): Promise<void>;
  list(
    request: typeof LIST_REQUEST,
    source: Readable,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array | string>>;
}

const SOURCE_IDENTITY_RESTORE_REQUEST = Object.freeze({
  action: 'source-identity' as const,
  queryId: 'source-system-identity-v1' as const,
  sql: `select system_identifier::text as system_identifier,
               (current_setting('server_version_num')::int / 10000)::int as postgres_major
          from pg_control_system()`,
});
const TARGET_IDENTITY_RESTORE_REQUEST = Object.freeze({
  action: 'target-identity' as const,
  queryId: 'target-system-identity-v1' as const,
  sql: `select system_identifier::text as system_identifier,
               (current_setting('server_version_num')::int / 10000)::int as postgres_major
          from pg_control_system()`,
});
const TARGET_STATE_RESTORE_REQUEST = Object.freeze({
  action: 'target-state' as const,
  queryId: 'empty-restore-target-v1' as const,
  sql: `select (
           (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
               and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%')
           + (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                 and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%')
           + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                 and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%')
           + (select count(*) from pg_collation c join pg_namespace n on n.oid = c.collnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_conversion c join pg_namespace n on n.oid = c.connamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_operator o join pg_namespace n on n.oid = o.oprnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_opclass o join pg_namespace n on n.oid = o.opcnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_opfamily o join pg_namespace n on n.oid = o.opfnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_ts_config o join pg_namespace n on n.oid = o.cfgnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_ts_dict o join pg_namespace n on n.oid = o.dictnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_ts_parser o join pg_namespace n on n.oid = o.prsnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_ts_template o join pg_namespace n on n.oid = o.tmplnamespace
               where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast'))
           + (select count(*) from pg_namespace
               where nspname not in ('public', 'pg_catalog', 'information_schema', 'pg_toast')
                 and nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%')
         )::int as user_object_count,
         case when to_regclass('drizzle.__drizzle_migrations') is null then 0 else 1 end::int
           as migration_history_count`,
});
const RESTORE_REQUEST = Object.freeze({
  action: 'restore' as const,
  executable: 'pg_restore' as const,
  args: Object.freeze([
    '--exit-on-error',
    '--no-owner',
    '--no-privileges',
    '--dbname=babycare',
  ]),
});
const VERIFY_INVARIANTS_REQUEST = Object.freeze({
  action: 'verify-invariants' as const,
  queryId: 'restore-invariants-v1' as const,
  isolation: 'repeatable read' as const,
  readOnly: true as const,
  migrationSql: `select id, hash, created_at from drizzle.__drizzle_migrations
                   order by created_at, id, hash`,
  invariantsSql: `select
    ((select count(*) from families where status = 'active') = 1) as single_active_family,
    ((select count(*) from babies where status = 'active') = 1) as single_active_baby,
    (not exists (
       select 1 from babies b left join families f on f.id = b.family_id where f.id is null
       union all
       select 1 from family_memberships fm
        left join families f on f.id = fm.family_id
        left join users u on u.id = fm.user_id
        where f.id is null or u.id is null
       union all
       select 1 from care_events ce
        left join babies b on b.id = ce.baby_id and b.family_id = ce.family_id
        left join family_memberships fm on fm.id = ce.actor_membership_id
          and fm.family_id = ce.family_id and fm.user_id = ce.actor_user_id
        where b.id is null or (ce.actor_membership_id is not null and fm.id is null)
    )) as ownership_valid,
    (not exists (
       select 1 from care_events ce
       left join feeding_sessions fs on fs.event_id = ce.id
       left join diaper_events de on de.event_id = ce.id
       left join sleep_intervals si on si.event_id = ce.id
       left join care_actions ca on ca.event_id = ce.id
       left join measurements m on m.event_id = ce.id
       where ((fs.event_id is not null)::int + (de.event_id is not null)::int
              + (si.event_id is not null)::int + (ca.event_id is not null)::int
              + (m.event_id is not null)::int) <> 1
          or (ce.event_type = 'feeding' and fs.event_id is null)
          or (ce.event_type = 'diaper' and de.event_id is null)
          or (ce.event_type = 'sleep' and si.event_id is null)
          or (ce.event_type in ('burping','spit_up','crying','bathing','medication')
              and (ca.event_id is null or ca.action_type::text <> ce.event_type::text))
          or (ce.event_type in ('temperature','weight')
              and (m.event_id is null or m.measurement_type::text <> ce.event_type::text))
    )) as typed_details_valid,
    (not exists (
       select 1 from care_events ce
       left join lateral (
         select count(*)::int as revision_count,
                min(from_version)::int as min_from,
                max(to_version)::int as max_to,
                (array_agg(revision_action order by to_version desc))[1] as latest_action
           from care_event_revisions where event_id = ce.id
       ) r on true
       where coalesce(r.revision_count, 0) <> ce.version - 1
          or (ce.version > 1 and (r.min_from <> 1 or r.max_to <> ce.version))
          or ((ce.status = 'voided') is distinct from coalesce(r.latest_action = 'void', false))
    )) as revision_edges_valid,
    (not exists (
       select 1 from care_handoff_checkpoints h
       left join babies b on b.id = h.baby_id and b.family_id = h.family_id
       left join family_memberships fm on fm.id = h.actor_membership_id
         and fm.family_id = h.family_id and fm.user_id = h.actor_user_id
       where b.id is null or (h.actor_membership_id is not null and fm.id is null)
    )) as handoffs_valid,
    (not exists (
       select 1 from care_handoff_reminder_rules r
       left join babies b on b.id = r.baby_id and b.family_id = r.family_id
       left join family_memberships fm on fm.id = r.actor_membership_id
         and fm.family_id = r.family_id and fm.user_id = r.actor_user_id
       where b.id is null or fm.id is null
    )) as reminders_valid`,
});
const REVOKE_SESSIONS_REQUEST = Object.freeze({
  action: 'revoke-sessions' as const,
  queryId: 'revoke-restored-sessions-v1' as const,
  transaction: true as const,
  sql: `update sessions
           set revoked_at = statement_timestamp()
         where revoked_at is null
         returning id`,
});

export interface FixedPg16RestoreRunner {
  sourceIdentity(
    request: typeof SOURCE_IDENTITY_RESTORE_REQUEST,
    signal: AbortSignal,
  ): Promise<unknown>;
  targetIdentity(
    request: typeof TARGET_IDENTITY_RESTORE_REQUEST,
    signal: AbortSignal,
  ): Promise<unknown>;
  targetState(
    request: typeof TARGET_STATE_RESTORE_REQUEST,
    signal: AbortSignal,
  ): Promise<unknown>;
  restore(
    request: typeof RESTORE_REQUEST,
    source: Readable,
    signal: AbortSignal,
  ): Promise<void>;
  verifyInvariants(
    request: typeof VERIFY_INVARIANTS_REQUEST,
    migrationFingerprint: string,
    signal: AbortSignal,
  ): Promise<unknown>;
  revokeSessions(
    request: typeof REVOKE_SESSIONS_REQUEST,
    signal: AbortSignal,
  ): Promise<unknown>;
}

interface Pg16AdapterLimits {
  catalogueMaxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_CATALOGUE_MAX_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 1_000;

const RestoreClusterIdentitySchema = z
  .object({
    systemIdentifier: z.string().min(1).max(128).regex(/^\S+$/),
    postgresMajor: z.number().int().positive().safe(),
  })
  .strict();
const RestoreTargetStateSchema = z
  .object({
    userObjectCount: z.number().int().nonnegative().safe(),
    migrationHistoryCount: z.number().int().nonnegative().safe(),
  })
  .strict();
const StructuralInvariantReportSchema = RestoreInvariantReportSchema.omit({
  summaryExecutable: true,
  timelineExecutable: true,
});
const ReadModelReportSchema = RestoreInvariantReportSchema.pick({
  summaryExecutable: true,
  timelineExecutable: true,
});
const MigrationFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

async function withTimeout<T>(
  timeoutMs: number,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = Symbol('timed-out');
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  const timeoutResult = new Promise<typeof timedOut>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([operationPromise, timeoutResult]);
    if (result !== timedOut) return result;
    let settlementTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operationPromise.then(
          () => undefined,
          () => undefined,
        ),
        new Promise<void>((resolve) => {
          settlementTimeout = setTimeout(resolve, DEFAULT_SETTLEMENT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (settlementTimeout) clearTimeout(settlementTimeout);
    }
    throw new BackupError(code);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function withSettledTimeout<T>(
  timeoutMs: number,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timedOut = Symbol('timed-out');
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  let timeout: NodeJS.Timeout | undefined;
  const timeoutResult = new Promise<typeof timedOut>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([operationPromise, timeoutResult]);
    if (result !== timedOut) return result;
    await operationPromise.then(
      () => undefined,
      () => undefined,
    );
    throw new BackupError(code);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function emptyCatalogueFacts(): DumpCatalogueFacts {
  return Object.fromEntries(
    Object.keys(REQUIRED_CATALOGUE_RELATIONS).map((key) => [key, false]),
  ) as DumpCatalogueFacts;
}

function acceptCatalogueLine(line: string, facts: DumpCatalogueFacts): void {
  const match = /\bTABLE\s+(public|drizzle)\s+([a-z0-9_]+)\b/.exec(line);
  if (!match) return;
  const [, schema, relation] = match;
  for (const [fact, expected] of Object.entries(REQUIRED_CATALOGUE_RELATIONS) as Array<
    [CatalogueFactName, readonly [string, string]]
  >) {
    if (schema === expected[0] && relation === expected[1]) facts[fact] = true;
  }
}

async function reduceCatalogue(
  output: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
): Promise<DumpCatalogueFacts> {
  const facts = emptyCatalogueFacts();
  let bytes = 0;
  let pending = '';
  for await (const chunk of output) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) throw new BackupError('backup_catalogue_invalid');
    pending += buffer.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) acceptCatalogueLine(line, facts);
  }
  if (pending) acceptCatalogueLine(pending, facts);
  return facts;
}

export function createPg16BackupTools(
  runner: FixedPg16Runner,
  limits: Pg16AdapterLimits = {},
): PostgresBackupTools {
  const maxBytes = limits.catalogueMaxBytes ?? DEFAULT_CATALOGUE_MAX_BYTES;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new BackupError('backup_invalid_config');
  }

  return {
    async toolMajor() {
      try {
        const major = await withTimeout(timeoutMs, 'backup_tool_failed', (signal) =>
          runner.toolMajor(TOOL_MAJOR_REQUEST, signal),
        );
        if (major !== POSTGRES_MAJOR_VERSION) throw new BackupError('backup_postgres_incompatible');
        return major;
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('backup_tool_failed');
      }
    },
    async sourceMajor() {
      try {
        const major = await withTimeout(timeoutMs, 'backup_tool_failed', (signal) =>
          runner.sourceMajor(SOURCE_MAJOR_REQUEST, signal),
        );
        if (major !== POSTGRES_MAJOR_VERSION) throw new BackupError('backup_postgres_incompatible');
        return major;
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('backup_tool_failed');
      }
    },
    async migrationHistory() {
      try {
        const raw = await withTimeout(timeoutMs, 'backup_tool_failed', (signal) =>
          runner.migrationHistory(MIGRATION_HISTORY_REQUEST, signal),
        );
        return z.array(MigrationHistoryFactSchema).min(1).parse(raw);
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('backup_migration_invalid');
      }
    },
    async dump(destination) {
      try {
        await withTimeout(timeoutMs, 'backup_tool_failed', (signal) =>
          runner.dump(DUMP_REQUEST, destination, signal),
        );
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('backup_tool_failed');
      }
    },
    async listDump(source) {
      try {
        return await withTimeout(timeoutMs, 'backup_catalogue_invalid', async (signal) => {
          const output = await runner.list(LIST_REQUEST, source, signal);
          return reduceCatalogue(output, maxBytes);
        });
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError('backup_catalogue_invalid');
      }
    },
  };
}

export function createPg16RestoreTools(
  backupTools: PostgresBackupTools,
  runner: FixedPg16RestoreRunner,
  probeReadModels: (signal: AbortSignal) => Promise<unknown>,
  limits: { timeoutMs?: number } = {},
): PostgresRestoreTools {
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new BackupError('restore_invalid_config');
  }

  async function run<T>(
    code: string,
    operation: (signal: AbortSignal) => Promise<unknown>,
    parse: (value: unknown) => T,
  ): Promise<T> {
    try {
      const value = await withSettledTimeout(timeoutMs, code, operation);
      return parse(value);
    } catch {
      throw new BackupError(code);
    }
  }

  return {
    ...backupTools,
    sourceIdentity(): Promise<RestoreClusterIdentity> {
      return run(
        'restore_identity_unknown',
        (signal) => runner.sourceIdentity(SOURCE_IDENTITY_RESTORE_REQUEST, signal),
        (value) => RestoreClusterIdentitySchema.parse(value),
      );
    },
    targetIdentity(): Promise<RestoreClusterIdentity> {
      return run(
        'restore_identity_unknown',
        (signal) => runner.targetIdentity(TARGET_IDENTITY_RESTORE_REQUEST, signal),
        (value) => RestoreClusterIdentitySchema.parse(value),
      );
    },
    targetState(): Promise<RestoreTargetState> {
      return run(
        'restore_target_check_failed',
        (signal) => runner.targetState(TARGET_STATE_RESTORE_REQUEST, signal),
        (value) => RestoreTargetStateSchema.parse(value),
      );
    },
    async restore(source): Promise<void> {
      await run(
        'restore_failed',
        async (signal) => {
          await runner.restore(RESTORE_REQUEST, source, signal);
          return true;
        },
        () => undefined,
      );
    },
    verifyInvariants(migrationFingerprint): Promise<StructuralInvariantReport> {
      let fingerprint: string;
      try {
        fingerprint = MigrationFingerprintSchema.parse(migrationFingerprint);
      } catch {
        throw new BackupError('restore_invariant_failed');
      }
      return run(
        'restore_invariant_failed',
        (signal) => runner.verifyInvariants(VERIFY_INVARIANTS_REQUEST, fingerprint, signal),
        (value) => StructuralInvariantReportSchema.parse(value),
      );
    },
    revokeSessions(): Promise<number> {
      return run(
        'restore_sanitation_failed',
        (signal) => runner.revokeSessions(REVOKE_SESSIONS_REQUEST, signal),
        (value) => z.number().int().nonnegative().safe().parse(value),
      );
    },
    probeReadModels() {
      return run(
        'restore_read_model_failed',
        (signal) => probeReadModels(signal),
        (value) => ReadModelReportSchema.parse(value),
      );
    },
  };
}
