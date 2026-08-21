export {
  BACKUP_CONTRACT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BackupError,
  BackupManifestV1Schema,
  POSTGRES_MAJOR_VERSION,
  canonicalMigrationFingerprint,
} from './contracts.js';
export type { BackupManifestV1, MigrationHistoryFact } from './contracts.js';
export { createBackup, verifyBackup } from './backup.js';
export type { BackupCreateConfig, BackupVerifyConfig } from './backup.js';
export {
  COMPLETE_CATALOGUE_FACTS,
  REQUIRED_CATALOGUE_RELATIONS,
  createPg16BackupTools,
} from './postgres-tools.js';
export type {
  DumpCatalogueFacts,
  FixedPg16Runner,
  PostgresBackupTools,
} from './postgres-tools.js';
