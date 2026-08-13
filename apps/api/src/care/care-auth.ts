import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorCode } from '@baby-care/contracts';
import { can } from '@baby-care/domain';
import type { AuthContext, AuthService } from '../auth/auth-service.js';
import { assertAllowedOrigin, OriginNotAllowedError } from '../auth/origin-guard.js';
import { readSessionCookie } from '../auth/session-auth.js';

export interface CareActorContext extends AuthContext {
  babyId: string;
}

export interface CareAuthDependencies {
  authService: AuthService;
  appOrigin: string;
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

export function createCareAuth(dependencies: CareAuthDependencies) {
  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
    capability: 'care.read' | 'care.write',
    enforceOrigin: boolean,
  ): Promise<CareActorContext | null> {
    if (enforceOrigin) {
      try {
        assertAllowedOrigin(request.headers.origin, dependencies.appOrigin);
      } catch (error) {
        if (error instanceof OriginNotAllowedError) {
          sendError(reply, 403, 'origin_not_allowed', 'This request origin is not allowed.', request.id);
          return null;
        }
        throw error;
      }
    }

    const rawToken = readSessionCookie(request.headers.cookie);
    if (!rawToken) {
      sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
      return null;
    }

    const authenticated = await dependencies.authService.authenticate(rawToken);
    if (!authenticated) {
      sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
      return null;
    }

    if (!can(authenticated.context.permissionLevel, capability)) {
      sendError(reply, 403, 'forbidden', 'This care operation is not allowed.', request.id);
      return null;
    }

    return {
      ...authenticated.context,
      babyId: authenticated.session.babyId,
    };
  }

  return {
    requireRead(request: FastifyRequest, reply: FastifyReply): Promise<CareActorContext | null> {
      return authenticate(request, reply, 'care.read', false);
    },
    requireWrite(request: FastifyRequest, reply: FastifyReply): Promise<CareActorContext | null> {
      return authenticate(request, reply, 'care.write', true);
    },
  };
}

export type CareAuth = ReturnType<typeof createCareAuth>;
