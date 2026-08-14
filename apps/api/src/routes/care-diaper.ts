import type { FastifyInstance } from 'fastify';
import { CreateDiaperInputSchema } from '@baby-care/contracts';
import type { CareAuth } from '../care/care-auth.js';
import { CareConfirmationRequiredError, CareValidationError } from '../care/care-errors.js';
import type { DiaperService } from '../care/diaper-service.js';

export function registerDiaperRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; diaperService: DiaperService },
): void {
  app.post('/api/care/diapers', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = CreateDiaperInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid diaper input.', traceId: request.id });
    }
    try {
      return reply.code(201).send(await dependencies.diaperService.create(actor, parsed.data, request.id));
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
