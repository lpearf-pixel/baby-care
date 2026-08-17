import { buildApp as buildProductionApp, type AppDependencies } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase as createProductionDatabase, type DatabaseContext } from './db.js';

interface StartupApp {
  addHook(name: 'onClose', hook: () => Promise<void>): void;
  listen(options: { host: string; port: number }): Promise<unknown>;
}

export interface StartServerOptions {
  environment?: NodeJS.ProcessEnv;
  createDatabase?: (url: string) => DatabaseContext;
  buildApp?: (dependencies: AppDependencies) => StartupApp;
}

async function closeAfterStartupFailure(database: DatabaseContext): Promise<void> {
  try {
    await database.close();
  } catch {
    // Preserve the actionable startup failure while still attempting pool cleanup.
  }
}

export async function startServer(options: StartServerOptions = {}): Promise<void> {
  const config = loadConfig(options.environment ?? process.env);
  const database = (options.createDatabase ?? createProductionDatabase)(config.DATABASE_URL);

  try {
    await database.migrate();
    const app = (options.buildApp ?? buildProductionApp)({
      checkDatabase: database.checkDatabase,
      database,
      appOrigin: config.BABY_CARE_APP_ORIGIN,
      setupToken: config.BABY_CARE_SETUP_TOKEN,
      sessionSecure: config.SESSION_SECURE,
      familyExportMaxBytes: config.FAMILY_EXPORT_MAX_BYTES,
    });
    app.addHook('onClose', async () => {
      await database.close();
    });
    await app.listen({ host: config.API_HOST, port: config.API_PORT });
  } catch (error) {
    await closeAfterStartupFailure(database);
    throw error;
  }
}
