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
import type { DatabaseContext } from '../db.js';
import type { FamilyExportRepository } from './family-export-repository.js';

export class FamilyExportTooLargeError extends Error {
  readonly code = 'export_too_large';

  constructor() {
    super('Family export exceeds the configured byte limit.');
    this.name = 'FamilyExportTooLargeError';
  }
}

export const FAMILY_EXPORT_DEADLINE_MS = 30_000;

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

async function waitForExport<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new FamilyExportCancelledError();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new FamilyExportCancelledError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createFamilyExportService(
  database: DatabaseContext,
  repository: FamilyExportRepository,
  maxBytes: number,
): FamilyExportService {
  return {
    async exportFamily(actor: AuthContext, generatedAt: Date, requestSignal?: AbortSignal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const deadline = setTimeout(abort, FAMILY_EXPORT_DEADLINE_MS);
      deadline.unref();
      requestSignal?.addEventListener('abort', abort, { once: true });
      if (requestSignal?.aborted) abort();
      try {
        const client = await waitForExport(() => database.pool.connect(), controller.signal);
        try {
          await waitForExport(
            () => client.query('begin isolation level repeatable read read only').then(() => undefined),
            controller.signal,
          );
          try {
            await waitForExport(
              () => client.query('set local statement_timeout = 30000').then(() => undefined),
              controller.signal,
            );
            const rows = await waitForExport(
              () => repository.readFamilyExport(client, actor.familyId),
              controller.signal,
            );
            const document = stableDocument(rows, generatedAt.toISOString());
            const serialized = Buffer.from(JSON.stringify(document), 'utf8');
            if (serialized.byteLength > maxBytes) throw new FamilyExportTooLargeError();
            await waitForExport(
              () => client.query('commit').then(() => undefined),
              controller.signal,
            );
            return { document, serialized };
          } catch (error) {
            try {
              await client.query('rollback');
            } catch {
              // Preserve the closed export failure rather than leaking a secondary rollback error.
            }
            throw error;
          }
        } finally {
          client.release();
        }
      } finally {
        clearTimeout(deadline);
        requestSignal?.removeEventListener('abort', abort);
      }
    },
  };
}
