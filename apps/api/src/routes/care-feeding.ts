import type { FastifyInstance } from 'fastify';
import { CreateFeedingSessionInputSchema, FeedingQuickValuesQuerySchema } from '@baby-care/contracts';
import type { CareAuth } from '../care/care-auth.js';
import {
  CareConfirmationRequiredError,
  CareStateConflictError,
  CareValidationError,
} from '../care/care-errors.js';
import type { FeedingService } from '../care/feeding-service.js';

export function registerFeedingRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; feedingService: FeedingService },
): void {
  app.post('/api/care/feeding-sessions', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;

    const parsed = CreateFeedingSessionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid feeding input.', traceId: request.id });
    }

    try {
      const result = await dependencies.feedingService.createSession(actor, parsed.data, request.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof CareConfirmationRequiredError) {
        return reply.code(409).send({
          code: 'care_confirmation_required',
          message: 'Confirmation is required.',
          traceId: request.id,
          details: { warnings: error.warnings },
        });
      }
      if (error instanceof CareValidationError) {
        return reply.code(400).send({ code: 'validation_failed', message: error.message, traceId: request.id });
      }
      if (error instanceof CareStateConflictError) {
        return reply.code(409).send({ code: 'care_state_conflict', message: error.message, traceId: request.id });
      }
      throw error;
    }
  });

  app.get('/api/care/feeding/quick-values', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    const parsed = FeedingQuickValuesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid liquid type.', traceId: request.id });
    }
    return reply.send(await dependencies.feedingService.quickValues(actor, parsed.data.liquidType));
  });
}
