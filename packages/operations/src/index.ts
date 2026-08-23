export {
  BACKUP_CONTRACT_VERSION,
  BACKUP_SCHEMA_VERSION,
  BackupError,
  BackupManifestV1Schema,
  POSTGRES_MAJOR_VERSION,
  canonicalMigrationFingerprint,
  RestoreInvariantReportSchema,
} from './contracts.js';
export type {
  BackupManifestV1,
  MigrationHistoryFact,
  RestoreInvariantReport,
} from './contracts.js';
export { createBackup, verifyBackup } from './backup.js';
export type { BackupCreateConfig, BackupVerifyConfig } from './backup.js';
export {
  COMPLETE_CATALOGUE_FACTS,
  REQUIRED_CATALOGUE_RELATIONS,
  createPg16BackupTools,
  createPg16RestoreTools,
} from './postgres-tools.js';
export type {
  DumpCatalogueFacts,
  FixedPg16Runner,
  FixedPg16RestoreRunner,
  PostgresBackupTools,
} from './postgres-tools.js';
export { restoreBackup } from './restore.js';
export type {
  PostgresRestoreTools,
  RestoreBackupConfig,
  RestoreClusterIdentity,
  RestoreTargetState,
  StructuralInvariantReport,
} from './restore.js';
export {
  parseOperatorConfig,
  runDisposableRestore,
  runExistingTargetRestore,
  runOperatorCli,
} from './cli.js';
export type { OperatorCliOptions, OperatorConfig, OperatorDependencies } from './cli.js';
