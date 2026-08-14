import type { FastifyInstance } from 'fastify';
import { CreateCareActionInputSchema } from '@baby-care/contracts';
import type { ActionService } from '../care/action-service.js';
import type { CareAuth } from '../care/care-auth.js';
import { CareConfirmationRequiredError, CareValidationError } from '../care/care-errors.js';

export function registerCareActionRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; actionService: ActionService },
): void {
  app.post('/api/care/actions', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = CreateCareActionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid care action input.', traceId: request.id });
    }
    try {
      return reply.code(201).send(await dependencies.actionService.create(actor, parsed.data, request.id));
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
      throw error;
    }
  });
}
