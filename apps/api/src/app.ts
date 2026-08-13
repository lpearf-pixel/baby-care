import Fastify, { type FastifyInstance } from 'fastify';
import { resolveTraceId } from '@baby-care/observability';
import { registerHealthRoute } from './routes/health.js';

export interface AppDependencies {
  checkDatabase: () => Promise<boolean>;
  now?: () => Date;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });
  const now = dependencies.now ?? (() => new Date());

  app.addHook('onRequest', async (request, reply) => {
    const rawTraceId = request.headers['x-trace-id'];
    const candidate = Array.isArray(rawTraceId) ? rawTraceId[0] : rawTraceId;
    reply.header('x-trace-id', resolveTraceId(candidate));
  });

  registerHealthRoute(app, {
    checkDatabase: dependencies.checkDatabase,
    now,
  });

  return app;
}
