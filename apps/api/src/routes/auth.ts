import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChangePasswordInputSchema,
  LoginInputSchema,
  type ApiErrorCode,
} from '@baby-care/contracts';
import { assertAllowedOrigin, OriginNotAllowedError } from '../auth/origin-guard.js';
import { createLoginLimiter } from '../auth/login-limiter.js';
import {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from '../auth/session-auth.js';
import type { AuthService } from '../auth/auth-service.js';

export interface AuthRouteDependencies {
  authService: AuthService;
  appOrigin: string;
  sessionSecure: boolean;
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

function requireOrigin(request: FastifyRequest, reply: FastifyReply, appOrigin: string): boolean {
  try {
    assertAllowedOrigin(request.headers.origin, appOrigin);
    return true;
  } catch (error) {
    if (error instanceof OriginNotAllowedError) {
      sendError(reply, 403, 'origin_not_allowed', 'This request origin is not allowed.', request.id);
      return false;
    }
    throw error;
  }
}

export function registerAuthRoutes(app: FastifyInstance, dependencies: AuthRouteDependencies): void {
  const limiter = createLoginLimiter({ limit: 10, windowMs: 60_000 });

  app.post('/api/auth/login', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;

    const parsed = LoginInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_failed', 'The login request is invalid.', request.id);
    }

    if (!limiter.allow(request.ip)) {
      return sendError(reply, 401, 'invalid_credentials', 'The login name or password is incorrect.', request.id);
    }

    const result = await dependencies.authService.login(
      parsed.data.loginName,
      parsed.data.password,
      request.id,
    );
    if (!result) {
      return sendError(reply, 401, 'invalid_credentials', 'The login name or password is incorrect.', request.id);
    }

    reply.header('set-cookie', serializeSessionCookie(result.rawToken, dependencies.sessionSecure));
    return reply.code(200).send(result.session);
  });

  app.get('/api/auth/session', async (request, reply) => {
    const rawToken = readSessionCookie(request.headers.cookie);
    if (!rawToken) {
      return sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
    }

    const result = await dependencies.authService.authenticate(rawToken);
    if (!result) {
      return sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
    }

    return reply.send(result.session);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;

    const rawToken = readSessionCookie(request.headers.cookie);
    if (rawToken) await dependencies.authService.logout(rawToken, request.id);
    reply.header('set-cookie', serializeClearedSessionCookie(dependencies.sessionSecure));
    return reply.code(204).send();
  });

  app.post('/api/auth/change-password', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;

    const rawToken = readSessionCookie(request.headers.cookie);
    if (!rawToken) {
      return sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
    }

    const parsed = ChangePasswordInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_failed', 'The password change request is invalid.', request.id);
    }

    const result = await dependencies.authService.changePassword(
      rawToken,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      request.id,
    );
    if (!result) {
      return sendError(reply, 401, 'invalid_credentials', 'The current password is incorrect.', request.id);
    }

    reply.header('set-cookie', serializeSessionCookie(result.rawToken, dependencies.sessionSecure));
    return reply.code(204).send();
  });
}
