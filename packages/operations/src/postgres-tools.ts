import type { Readable, Writable } from 'node:stream';

import { z } from 'zod';

import {
  BackupError,
  MigrationHistoryFactSchema,
  POSTGRES_MAJOR_VERSION,
  type MigrationHistoryFact,
} from './contracts.js';

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

interface Pg16AdapterLimits {
  catalogueMaxBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_CATALOGUE_MAX_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  timeoutMs: number,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const rejection = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new BackupError(code));
    }, timeoutMs);
    timeout.unref();
  });
  try {
    return await Promise.race([operation(controller.signal), rejection]);
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
