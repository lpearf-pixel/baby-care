import type { FastifyInstance, FastifyReply } from 'fastify';
import { EditCareEventInputSchema } from '@baby-care/contracts';
import { z } from 'zod';
import type { CareAuth } from '../care/care-auth.js';
import {
  CareEventNotFoundError,
  CareStateConflictError,
  CareValidationError,
} from '../care/care-errors.js';
import type { RevisionService } from '../care/revision-service.js';

const EventParamsSchema = z.object({ eventId: z.string().uuid() }).strict();

function sendRevisionError(reply: FastifyReply, traceId: string, error: unknown) {
  if (error instanceof CareEventNotFoundError) {
    return reply.code(404).send({ code: 'care_event_not_found', message: error.message, traceId });
  }
  if (error instanceof CareStateConflictError) {
    return reply.code(409).send({ code: 'care_state_conflict', message: error.message, traceId });
  }
  if (error instanceof CareValidationError) {
    return reply.code(400).send({ code: 'validation_failed', message: error.message, traceId });
  }
  throw error;
}

export function registerCareRevisionRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; revisionService: RevisionService },
): void {
  app.patch('/api/care/events/:eventId', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const params = EventParamsSchema.safeParse(request.params);
    const input = EditCareEventInputSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care edit.', traceId: request.id });
    }
    try {
      return reply.send(await dependencies.revisionService.edit(actor, params.data.eventId, input.data, request.id));
    } catch (error) {
      return sendRevisionError(reply, request.id, error);
    }
  });

  app.post('/api/care/events/:eventId/undo', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const params = EventParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care event id.', traceId: request.id });
    }
    try {
      return reply.send(await dependencies.revisionService.undo(actor, params.data.eventId, request.id));
    } catch (error) {
      return sendRevisionError(reply, request.id, error);
    }
  });
}
