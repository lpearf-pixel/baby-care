import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  UndoCareEventRequestSchema,
  UpdateCareEventRequestSchema,
} from '@baby-care/contracts';
import { z } from 'zod';
import type { CareAuth } from '../care/care-auth.js';
import {
  CareEventNotFoundError,
  CareStateConflictError,
  CareValidationError,
} from '../care/care-errors.js';
import type { RevisionService } from '../care/revision-service.js';
import type { RevisionQueryService } from '../care/revision-query-service.js';

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
  dependencies: {
    careAuth: CareAuth;
    revisionService: RevisionService;
    revisionQueryService: RevisionQueryService;
  },
): void {
  app.patch('/api/care/events/:eventId', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const params = EventParamsSchema.safeParse(request.params);
    const input = UpdateCareEventRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care edit.', traceId: request.id });
    }
    try {
      return reply.send(await dependencies.revisionService.edit(
        actor,
        params.data.eventId,
        input.data.expectedVersion,
        input.data.event,
        request.id,
      ));
    } catch (error) {
      return sendRevisionError(reply, request.id, error);
    }
  });

  app.post('/api/care/events/:eventId/undo', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const params = EventParamsSchema.safeParse(request.params);
    const input = UndoCareEventRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care undo.', traceId: request.id });
    }
    try {
      return reply.send(await dependencies.revisionService.undo(
        actor,
        params.data.eventId,
        input.data.expectedVersion,
        request.id,
      ));
    } catch (error) {
      return sendRevisionError(reply, request.id, error);
    }
  });

  app.get('/api/care/events/:eventId/revisions', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    const params = EventParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care event id.', traceId: request.id });
    }
    return reply.send(await dependencies.revisionQueryService.list(actor, params.data.eventId));
  });
}
