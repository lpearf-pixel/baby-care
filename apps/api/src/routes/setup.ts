import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { SetupInputSchema, type ApiErrorCode } from '@baby-care/contracts';
import { assertAllowedOrigin, OriginNotAllowedError } from '../auth/origin-guard.js';
import { SetupClosedError } from '../family/family-repository.js';
import type { SetupService } from '../family/setup-service.js';

export interface SetupRouteDependencies {
  setupService: SetupService;
  appOrigin: string;
  setupToken: string;
}

function secretMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  traceId: string,
) {
  return reply.code(statusCode).send({ code, message, traceId });
}

export function registerSetupRoutes(
  app: FastifyInstance,
  dependencies: SetupRouteDependencies,
): void {
  app.get('/api/setup/status', async () => ({
    required: await dependencies.setupService.isRequired(),
  }));

  app.post('/api/setup', async (request, reply) => {
    try {
      assertAllowedOrigin(request.headers.origin, dependencies.appOrigin);
    } catch (error) {
      if (error instanceof OriginNotAllowedError) {
        return sendError(reply, 403, 'origin_not_allowed', 'This request origin is not allowed.', request.id);
      }
      throw error;
    }

    if (!(await dependencies.setupService.isRequired())) {
      return sendError(reply, 409, 'setup_closed', 'Setup is already complete.', request.id);
    }

    const rawSetupToken = request.headers['x-baby-care-setup-token'];
    const candidateSetupToken = Array.isArray(rawSetupToken) ? rawSetupToken[0] : rawSetupToken;
    if (!secretMatches(candidateSetupToken, dependencies.setupToken)) {
      return sendError(reply, 403, 'setup_token_invalid', 'The setup token is invalid.', request.id);
    }

    const parsed = SetupInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_failed', 'The setup request is invalid.', request.id);
    }

    try {
      await dependencies.setupService.initialize(parsed.data, request.id);
      return reply.code(201).send({ status: 'created' });
    } catch (error) {
      if (error instanceof SetupClosedError) {
        return sendError(reply, 409, 'setup_closed', 'Setup is already complete.', request.id);
      }
      throw error;
    }
  });
}
