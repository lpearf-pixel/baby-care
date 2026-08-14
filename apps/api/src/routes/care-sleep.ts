import type { FastifyInstance } from 'fastify';
import { StartSleepInputSchema, WakeSleepInputSchema } from '@baby-care/contracts';
import type { CareAuth } from '../care/care-auth.js';
import {
  CareConfirmationRequiredError,
  CareStateConflictError,
  CareValidationError,
} from '../care/care-errors.js';
import type { SleepService } from '../care/sleep-service.js';

function handleSleepError(reply: Parameters<Parameters<FastifyInstance['post']>[1]>[1], requestId: string, error: unknown) {
  if (error instanceof CareConfirmationRequiredError) {
    return reply.code(409).send({
      code: 'care_confirmation_required',
      message: 'Confirmation is required.',
      traceId: requestId,
      details: { warnings: error.warnings },
    });
  }
  if (error instanceof CareValidationError) {
    return reply.code(400).send({ code: 'validation_failed', message: error.message, traceId: requestId });
  }
  if (error instanceof CareStateConflictError) {
    return reply.code(409).send({ code: 'care_state_conflict', message: error.message, traceId: requestId });
  }
  throw error;
}

export function registerSleepRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; sleepService: SleepService },
): void {
  app.post('/api/care/sleep/start', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = StartSleepInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid sleep input.', traceId: request.id });
    }
    try {
      return reply.code(201).send(await dependencies.sleepService.start(actor, parsed.data, request.id));
    } catch (error) {
      return handleSleepError(reply, request.id, error);
    }
  });

  app.post('/api/care/sleep/wake', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = WakeSleepInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid sleep input.', traceId: request.id });
    }
    try {
      return reply.code(200).send(await dependencies.sleepService.wake(actor, parsed.data, request.id));
    } catch (error) {
      return handleSleepError(reply, request.id, error);
    }
  });
}
