import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { checkDatabase, createDatabasePool } from '../src/db.ts';
import { runMigrations } from '../src/migrate.ts';
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('PostgreSQL migration integration', () => {
  const pool = createDatabasePool(databaseUrl ?? '');
  beforeAll(async () => { await pool.query('DROP TABLE IF EXISTS app_meta CASCADE'); await pool.query('DROP TABLE IF EXISTS schema_migrations CASCADE'); });
  afterAll(async () => { await pool.end(); });
  test('database readiness check succeeds against PostgreSQL', async () => { await expect(checkDatabase(pool)).resolves.toBeUndefined(); });
  test('applies foundation migration once across repeated runs', async () => { const migrationsDir = resolve(process.cwd(), '../../infra/postgres/migrations'); const first = await runMigrations(pool, migrationsDir); const second = await runMigrations(pool, migrationsDir); const rows = await pool.query('SELECT filename FROM schema_migrations ORDER BY filename'); expect(first.applied).toEqual(['0001_foundation.sql']); expect(second.applied).toEqual([]); expect(rows.rows).toEqual([{ filename: '0001_foundation.sql' }]); });
});
