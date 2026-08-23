import type { FastifyInstance } from 'fastify';
import { CreateCareHandoffInputSchema, ReplaceHandoffReminderRulesInputSchema } from '@baby-care/contracts';
import { z } from 'zod';
import type { CareAuth } from '../care/care-auth.js';
import { CareValidationError } from '../care/care-errors.js';
import type { HandoffService } from '../care/handoff-service.js';
import {
  CareHandoffNotFoundError,
  type HandoffSummaryService,
} from '../care/handoff-summary-service.js';

const HandoffParamsSchema = z.object({ handoffId: z.string().uuid() }).strict();

export function registerCareHandoffRoutes(
  app: FastifyInstance,
  dependencies: {
    careAuth: CareAuth;
    handoffService: HandoffService;
    handoffSummaryService: HandoffSummaryService;
  },
): void {
  app.post('/api/care/handoffs', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = CreateCareHandoffInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care handoff input.', traceId: request.id });
    }
    try {
      return reply.code(201).send(await dependencies.handoffService.create(actor, parsed.data, request.id));
    } catch (error) {
      if (error instanceof CareValidationError) {
        return reply.code(400).send({ code: 'validation_failed', message: error.message, traceId: request.id });
      }
      throw error;
    }
  });

  app.get('/api/care/handoffs/latest', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    return reply.send(await dependencies.handoffSummaryService.latest(actor));
  });

  app.get('/api/care/handoffs/:handoffId/summary', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    const parsed = HandoffParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care handoff id.', traceId: request.id });
    }
    try {
      return reply.send(await dependencies.handoffSummaryService.byId(actor, parsed.data.handoffId));
    } catch (error) {
      if (error instanceof CareHandoffNotFoundError) {
        return reply.code(404).send({ code: 'care_event_not_found', message: error.message, traceId: request.id });
      }
      throw error;
    }
  });

  app.get('/api/care/handoff-reminders', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    return reply.send(await dependencies.handoffService.reminders(actor));
  });

  app.put('/api/care/handoff-reminders', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = ReplaceHandoffReminderRulesInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid handoff reminder rules.', traceId: request.id });
    }
    return reply.send(await dependencies.handoffService.replaceReminders(actor, parsed.data));
  });
}
