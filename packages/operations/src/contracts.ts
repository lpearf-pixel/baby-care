import { createHash } from 'node:crypto';

import { z } from 'zod';

export const BACKUP_SCHEMA_VERSION = 1 as const;
export const BACKUP_CONTRACT_VERSION = 1 as const;
export const POSTGRES_MAJOR_VERSION = 16 as const;

const LowerHexSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const BackupManifestV1Schema = z
  .object({
    schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
    createdAt: z.string().datetime({ offset: true }),
    postgresMajor: z.literal(POSTGRES_MAJOR_VERSION),
    dump: z
      .object({
        format: z.literal('postgres-custom'),
        sha256: LowerHexSha256Schema,
        bytes: z.number().int().positive(),
      })
      .strict(),
    migrationFingerprint: LowerHexSha256Schema,
    backupContractVersion: z.literal(BACKUP_CONTRACT_VERSION),
  })
  .strict();

export type BackupManifestV1 = z.infer<typeof BackupManifestV1Schema>;

export const MigrationHistoryFactSchema = z
  .object({
    id: z.number().int().positive(),
    hash: LowerHexSha256Schema,
    createdAt: z.number().int().nonnegative().safe(),
  })
  .strict();

export type MigrationHistoryFact = z.infer<typeof MigrationHistoryFactSchema>;

export class BackupError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'BackupError';
  }
}

export function canonicalMigrationFingerprint(facts: readonly MigrationHistoryFact[]): string {
  const result = z.array(MigrationHistoryFactSchema).min(1).safeParse(facts);
  if (!result.success) throw new BackupError('backup_migration_invalid');
  const parsed = result.data;
  const ordered = [...parsed].sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      left.id - right.id ||
      left.hash.localeCompare(right.hash),
  );
  if (new Set(ordered.map((fact) => fact.id)).size !== ordered.length) {
    throw new BackupError('backup_migration_invalid');
  }
  const canonical = JSON.stringify(
    ordered.map((fact) => [fact.id, fact.hash, fact.createdAt] as const),
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
