import type { FastifyInstance } from 'fastify';
import { CreateMeasurementInputSchema } from '@baby-care/contracts';
import type { CareAuth } from '../care/care-auth.js';
import { CareConfirmationRequiredError, CareValidationError } from '../care/care-errors.js';
import type { MeasurementService } from '../care/measurement-service.js';

export function registerMeasurementRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; measurementService: MeasurementService },
): void {
  app.post('/api/care/measurements', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = CreateMeasurementInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Invalid measurement input.', traceId: request.id });
    }
    try {
      return reply.code(201).send(await dependencies.measurementService.create(actor, parsed.data, request.id));
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
