import type { FastifyInstance } from 'fastify';
import { CareSummaryQuerySchema, CareTimelineQuerySchema } from '@baby-care/contracts';
import type { CareAuth } from '../care/care-auth.js';
import type { QueryService } from '../care/query-service.js';

export function registerCareQueryRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; queryService: QueryService },
): void {
  app.get('/api/care/summary', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    const parsed = CareSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid summary query.', traceId: request.id });
    }
    return reply.send(await dependencies.queryService.summary(actor, new Date(parsed.data.at)));
  });

  app.get('/api/care/timeline', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    const parsed = CareTimelineQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid timeline query.', traceId: request.id });
    }
    return reply.send(await dependencies.queryService.timeline(actor, new Date(parsed.data.before), parsed.data.limit));
  });
}
