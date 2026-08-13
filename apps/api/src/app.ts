import Fastify, { type FastifyInstance } from 'fastify';
import { resolveTraceId } from '@baby-care/observability';
import { createAuthService } from './auth/auth-service.js';
import type { DatabaseContext } from './db.js';
import { createFamilyRepository } from './family/family-repository.js';
import { createSetupService } from './family/setup-service.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoute } from './routes/health.js';
import { registerSetupRoutes } from './routes/setup.js';

export interface AppDependencies {
  checkDatabase: () => Promise<boolean>;
  now?: () => Date;
  database?: DatabaseContext;
  appOrigin?: string;
  setupToken?: string;
  sessionSecure?: boolean;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId(request) {
      const rawTraceId = request.headers['x-trace-id'];
      const candidate = Array.isArray(rawTraceId) ? rawTraceId[0] : rawTraceId;
      return resolveTraceId(candidate);
    },
  });
  const now = dependencies.now ?? (() => new Date());

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-trace-id', request.id);
  });

  registerHealthRoute(app, {
    checkDatabase: dependencies.checkDatabase,
    now,
  });

  if (dependencies.database && dependencies.appOrigin) {
    registerAuthRoutes(app, {
      authService: createAuthService(dependencies.database, now),
      appOrigin: dependencies.appOrigin,
      sessionSecure: dependencies.sessionSecure ?? false,
    });
  }

  if (dependencies.database && dependencies.appOrigin && dependencies.setupToken) {
    registerSetupRoutes(app, {
      setupService: createSetupService(createFamilyRepository(dependencies.database), now),
      appOrigin: dependencies.appOrigin,
      setupToken: dependencies.setupToken,
    });
  }

  return app;
}
