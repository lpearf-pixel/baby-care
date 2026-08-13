import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationQueryResult<Row = Record<string, unknown>> { rows: Row[]; }
export interface MigrationClient { query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<MigrationQueryResult<Row>>; }
export interface MigrationResult { applied: string[]; }

async function readApplied(client: MigrationClient): Promise<Set<string>> {
  const table = await client.query<{ table_name: string | null }>("SELECT to_regclass('public.schema_migrations') AS table_name");
  if (!table.rows[0]?.table_name) return new Set();
  const result = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(result.rows.map((row) => row.filename));
}

export async function runMigrations(client: MigrationClient, migrationsDir: string): Promise<MigrationResult> {
  const filenames = (await readdir(migrationsDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  const alreadyApplied = await readApplied(client);
  const applied: string[] = [];
  for (const filename of filenames) {
    if (alreadyApplied.has(filename)) continue;
    const sql = await readFile(join(migrationsDir, filename), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename, applied_at) VALUES ($1, CURRENT_TIMESTAMP)', [filename]);
      await client.query('COMMIT');
      applied.push(filename);
      alreadyApplied.add(filename);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return { applied };
}
