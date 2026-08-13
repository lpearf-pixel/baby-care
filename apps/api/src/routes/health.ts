import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@baby-care/contracts';

interface HealthRouteDependencies {
  checkDatabase: () => Promise<boolean>;
  now: () => Date;
}

export function registerHealthRoute(
  app: FastifyInstance,
  dependencies: HealthRouteDependencies,
): void {
  app.get('/health', async (_request, reply) => {
    const databaseOk = await dependencies.checkDatabase();
    const body = HealthResponseSchema.parse(
      databaseOk
        ? {
            status: 'ok',
            service: 'baby-care-api',
            database: 'ok',
            timestamp: dependencies.now().toISOString(),
          }
        : {
            status: 'degraded',
            service: 'baby-care-api',
            database: 'unavailable',
            timestamp: dependencies.now().toISOString(),
          },
    );

    return reply.code(databaseOk ? 200 : 503).send(body);
  });
}
