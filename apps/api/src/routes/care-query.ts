import type { FastifyInstance } from 'fastify';
import { CareSummaryQuerySchema, CareTimelineQuerySchema } from '@baby-care/contracts';
import { z } from 'zod';
import type { CareAuth } from '../care/care-auth.js';
import { CareValidationError } from '../care/care-errors.js';
import type { QueryService } from '../care/query-service.js';

const EventParamsSchema = z.object({ eventId: z.string().uuid() }).strict();

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
    try {
      return reply.send(await dependencies.queryService.timeline(actor, parsed.data));
    } catch (error) {
      if (error instanceof CareValidationError) {
        return reply.code(400).send({ code: 'validation_failed', message: error.message, traceId: request.id });
      }
      throw error;
    }
  });

  app.get('/api/care/events/:eventId', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    const params = EventParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care event id.', traceId: request.id });
    }
    const detail = await dependencies.queryService.detail(actor, params.data.eventId);
    if (!detail) {
      return reply.code(404).send({
        code: 'care_event_not_found',
        message: 'Care event was not found.',
        traceId: request.id,
      });
    }
    return reply.send(detail);
  });
}
