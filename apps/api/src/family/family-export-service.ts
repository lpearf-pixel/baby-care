import {
  compareFamilyExportCareEvents,
  compareFamilyExportCareRevisions,
  compareFamilyExportHandoffCheckpoints,
  compareFamilyExportHandoffReminderRules,
  compareFamilyExportMembers,
  FAMILY_EXPORT_SCHEMA_VERSION,
  FamilyExportSchemaV1,
} from '@baby-care/contracts';
import type { FamilyExportV1 } from '@baby-care/contracts';
import type { AuthContext } from '../auth/auth-service.js';
import { DATABASE_OPERATION_DEADLINE_MS, type DatabaseContext } from '../db.js';
import type { FamilyExportRepository } from './family-export-repository.js';

export class FamilyExportTooLargeError extends Error {
  readonly code = 'export_too_large';

  constructor() {
    super('Family export exceeds the configured byte limit.');
    this.name = 'FamilyExportTooLargeError';
  }
}

export class FamilyExportCancelledError extends Error {
  readonly code = 'export_cancelled';

  constructor() {
    super('Family export was cancelled.');
    this.name = 'FamilyExportCancelledError';
  }
}

export interface FamilyExportService {
  exportFamily(actor: AuthContext, generatedAt: Date, signal?: AbortSignal): Promise<{
    document: FamilyExportV1;
    serialized: Buffer;
  }>;
}

function stableDocument(
  rows: Awaited<ReturnType<FamilyExportRepository['readFamilyExport']>>,
  generatedAt: string,
): FamilyExportV1 {
  return FamilyExportSchemaV1.parse({
    schemaVersion: FAMILY_EXPORT_SCHEMA_VERSION,
    generatedAt,
    family: rows.family,
    baby: rows.baby,
    members: [...rows.members].sort(compareFamilyExportMembers),
    careEvents: [...rows.careEvents].sort(compareFamilyExportCareEvents),
    careRevisions: [...rows.careRevisions].sort(compareFamilyExportCareRevisions),
    handoffCheckpoints: [...rows.handoffCheckpoints].sort(compareFamilyExportHandoffCheckpoints),
    handoffReminderRules: [...rows.handoffReminderRules].sort(compareFamilyExportHandoffReminderRules),
  });
}

async function settleClientOperation<T>(
  operation: () => Promise<T>,
  client: { release(error?: Error | boolean): void },
  signal: AbortSignal | undefined,
  destroyClient: () => void,
): Promise<T> {
  if (signal?.aborted) {
    destroyClient();
    throw new FamilyExportCancelledError();
  }
  let aborted = false;
  const abort = () => {
    aborted = true;
    destroyClient();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    try {
      const result = await operation();
      if (aborted || signal?.aborted) throw new FamilyExportCancelledError();
      return result;
    } catch (error) {
      if (aborted || signal?.aborted) throw new FamilyExportCancelledError();
      throw error;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

function isStatementTimeout(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === '57014';
}

export function createFamilyExportService(
  database: DatabaseContext,
  repository: FamilyExportRepository,
  maxBytes: number,
): FamilyExportService {
  return {
    async exportFamily(actor: AuthContext, generatedAt: Date, requestSignal?: AbortSignal) {
      const client = await database.pool.connect();
      let clientDestroyed = false;
      const destroyClient = () => {
        if (clientDestroyed) return;
        clientDestroyed = true;
        client.release(true);
      };
      if (requestSignal?.aborted) {
        destroyClient();
        throw new FamilyExportCancelledError();
      }

      let transactionStarted = false;
      try {
        await settleClientOperation(
          () => client.query('begin isolation level repeatable read read only').then(() => undefined),
          client,
          requestSignal,
          destroyClient,
        );
        transactionStarted = true;
        await settleClientOperation(
          () => client.query('set local statement_timeout = ' + DATABASE_OPERATION_DEADLINE_MS).then(() => undefined),
          client,
          requestSignal,
          destroyClient,
        );
        const rows = await settleClientOperation(
          () => repository.readFamilyExport(client, actor.familyId),
          client,
          requestSignal,
          destroyClient,
        );
        const document = stableDocument(rows, generatedAt.toISOString());
        const serialized = Buffer.from(JSON.stringify(document), 'utf8');
        if (serialized.byteLength > maxBytes) throw new FamilyExportTooLargeError();
        await settleClientOperation(
          () => client.query('commit').then(() => undefined),
          client,
          requestSignal,
          destroyClient,
        );
        transactionStarted = false;
        return { document, serialized };
      } catch (error) {
        if (!clientDestroyed && transactionStarted) {
          try {
            await settleClientOperation(
              () => client.query('rollback').then(() => undefined),
              client,
              requestSignal,
              destroyClient,
            );
          } catch {
            // Preserve the closed export failure rather than leaking a secondary rollback error.
          }
        }
        if (requestSignal?.aborted || isStatementTimeout(error)) {
          throw new FamilyExportCancelledError();
        }
        throw error;
      } finally {
        if (!clientDestroyed) client.release();
      }
    },
  };
}
