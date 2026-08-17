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

export interface FamilyExportService {
  exportFamily(actor: AuthContext, generatedAt: Date): Promise<{
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

export function createFamilyExportService(
  database: DatabaseContext,
  repository: FamilyExportRepository,
  maxBytes: number,
): FamilyExportService {
  return {
    async exportFamily(actor: AuthContext, generatedAt: Date) {
      const client = await database.pool.connect();
      try {
        await client.query('begin isolation level repeatable read read only');
        try {
          const rows = await repository.readFamilyExport(client, actor.familyId);
          const document = stableDocument(rows, generatedAt.toISOString());
          const serialized = Buffer.from(JSON.stringify(document), 'utf8');
          if (serialized.byteLength > maxBytes) throw new FamilyExportTooLargeError();
          await client.query('commit');
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
    },
  };
}
