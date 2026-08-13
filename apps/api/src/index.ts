import { fileURLToPath } from 'node:url';
import { createDiagnosticEvent } from '@baby-care/shared';
import { loadConfig } from './config.ts';
import { checkDatabase, createDatabasePool } from './db.ts';
import { runMigrations } from './migrate.ts';
import { buildServer } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createDatabasePool(config.databaseUrl);
  const migrationsDir = fileURLToPath(new URL('../../../infra/postgres/migrations/', import.meta.url));
  pool.on('error', () => console.error(JSON.stringify(createDiagnosticEvent({ level: 'error', eventCode: 'DATABASE_POOL_ERROR', component: 'database', message: 'PostgreSQL pool emitted an unexpected error' }))));
  await runMigrations(pool, migrationsDir);
  const server = buildServer({ checkDatabase: () => checkDatabase(pool) });
  await server.listen({ host: config.apiHost, port: config.apiPort });
  console.log(JSON.stringify(createDiagnosticEvent({ level: 'info', eventCode: 'API_LISTENING', component: 'api', message: `Baby Care API listening on ${config.apiHost}:${config.apiPort}` })));
  const shutdown = async () => { await server.close(); await pool.end(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown startup error';
  console.error(JSON.stringify(createDiagnosticEvent({ level: 'error', eventCode: 'API_STARTUP_FAILED', component: 'api', message })));
  process.exitCode = 1;
});
