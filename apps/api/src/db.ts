import { Pool } from 'pg';

export function createDatabasePool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function checkDatabase(pool: Pick<Pool, 'query'>): Promise<void> {
  await pool.query('SELECT 1 AS ok');
}
