import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const app = buildApp({ checkDatabase: database.checkDatabase });

app.addHook('onClose', async () => {
  await database.close();
});

await app.listen({ host: config.API_HOST, port: config.API_PORT });
