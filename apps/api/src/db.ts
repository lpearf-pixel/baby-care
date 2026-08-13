import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

export interface DatabaseContext {
  pool: pg.Pool;
  orm: ReturnType<typeof drizzle>;
  checkDatabase: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseContext {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const orm = drizzle(pool);

  return {
    pool,
    orm,
    async checkDatabase(): Promise<boolean> {
      try {
        await pool.query('select 1 as ok');
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
