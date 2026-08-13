import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as runDrizzleMigrations } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';

const migrationsFolder = fileURLToPath(new URL('../../../migrations', import.meta.url));

export interface DatabaseContext {
  pool: pg.Pool;
  orm: ReturnType<typeof drizzle>;
  migrate: () => Promise<void>;
  checkDatabase: () => Promise<boolean>;
  close: () => Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseContext {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const orm = drizzle(pool, { schema });

  return {
    pool,
    orm,
    async migrate(): Promise<void> {
      await runDrizzleMigrations(orm, { migrationsFolder });
    },
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
