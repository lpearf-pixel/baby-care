import { createDatabase } from '../../../apps/api/src/db.js';
import { verifyRestoredDatabase } from '../../../apps/api/src/operations/verify-restored-database.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write('restore_read_model_failed\n');
  process.exitCode = 1;
} else {
  const database = createDatabase(databaseUrl);
  try {
    await verifyRestoredDatabase(database);
    process.stdout.write('restore_read_model_verified\n');
  } catch {
    process.stdout.write('restore_read_model_failed\n');
    process.exitCode = 1;
  } finally {
    await database.close().catch(() => undefined);
  }
}
