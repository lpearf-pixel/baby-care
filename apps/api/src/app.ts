import Fastify, { type FastifyInstance } from 'fastify';
import { resolveTraceId } from '@baby-care/observability';
import { createAuthService } from './auth/auth-service.js';
import { createActionService } from './care/action-service.js';
import { createCareAuth } from './care/care-auth.js';
import { createDiaperService } from './care/diaper-service.js';
import { createFeedingService } from './care/feeding-service.js';
import { createHandoffService } from './care/handoff-service.js';
import { createHandoffSummaryService } from './care/handoff-summary-service.js';
import { createMeasurementService } from './care/measurement-service.js';
import { createQueryService } from './care/query-service.js';
import { createRevisionService } from './care/revision-service.js';
import { createSleepService } from './care/sleep-service.js';
import type { DatabaseContext } from './db.js';
import { createFamilyRepository } from './family/family-repository.js';
import { createFamilyService } from './family/family-service.js';
import { createSetupService } from './family/setup-service.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCareActionRoutes } from './routes/care-actions.js';
import { registerDiaperRoutes } from './routes/care-diaper.js';
import { registerFeedingRoutes } from './routes/care-feeding.js';
import { registerCareHandoffRoutes } from './routes/care-handoffs.js';
import { registerMeasurementRoutes } from './routes/care-measurements.js';
import { registerCareQueryRoutes } from './routes/care-query.js';
import { registerCareRevisionRoutes } from './routes/care-revisions.js';
import { registerSleepRoutes } from './routes/care-sleep.js';
import { registerFamilyRoutes } from './routes/family.js';
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
    const authService = createAuthService(dependencies.database, now);
    const careAuth = createCareAuth({ authService, appOrigin: dependencies.appOrigin });
    const queryService = createQueryService(dependencies.database);
    registerAuthRoutes(app, {
      authService,
      appOrigin: dependencies.appOrigin,
      sessionSecure: dependencies.sessionSecure ?? false,
    });
    registerFamilyRoutes(app, {
      authService,
      familyService: createFamilyService(dependencies.database),
      appOrigin: dependencies.appOrigin,
    });
    registerFeedingRoutes(app, {
      careAuth,
      feedingService: createFeedingService(dependencies.database, now),
    });
    registerDiaperRoutes(app, {
      careAuth,
      diaperService: createDiaperService(dependencies.database, now),
    });
    registerSleepRoutes(app, {
      careAuth,
      sleepService: createSleepService(dependencies.database, now),
    });
    registerCareActionRoutes(app, {
      careAuth,
      actionService: createActionService(dependencies.database, now),
    });
    registerMeasurementRoutes(app, {
      careAuth,
      measurementService: createMeasurementService(dependencies.database, now),
    });
    registerCareQueryRoutes(app, {
      careAuth,
      queryService,
    });
    registerCareHandoffRoutes(app, {
      careAuth,
      handoffService: createHandoffService(dependencies.database, now),
      handoffSummaryService: createHandoffSummaryService(dependencies.database),
    });
    registerCareRevisionRoutes(app, {
      careAuth,
      revisionService: createRevisionService(dependencies.database, now),
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
