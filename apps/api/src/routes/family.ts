import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateNannyInputSchema,
  ResetNannyPasswordInputSchema,
  UpdateBabyInputSchema,
  UpdateFamilyInputSchema,
  UpdateMemberStatusInputSchema,
  type ApiErrorCode,
} from '@baby-care/contracts';
import type { AuthContext, AuthService } from '../auth/auth-service.js';
import { assertAllowedOrigin, OriginNotAllowedError } from '../auth/origin-guard.js';
import { readSessionCookie } from '../auth/session-auth.js';
import {
  FamilyForbiddenError,
  LoginNameConflictError,
  MemberAlreadyExistsError,
  type FamilyService,
} from '../family/family-service.js';

export interface FamilyRouteDependencies {
  authService: AuthService;
  familyService: FamilyService;
  appOrigin: string;
}

function sendError(reply: FastifyReply, statusCode: number, code: ApiErrorCode, message: string, traceId: string) {
  return reply.code(statusCode).send({ code, message, traceId });
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply, authService: AuthService): Promise<AuthContext | null> {
  const rawToken = readSessionCookie(request.headers.cookie);
  if (!rawToken) {
    sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
    return null;
  }
  const authenticated = await authService.authenticate(rawToken);
  if (!authenticated) {
    sendError(reply, 401, 'unauthenticated', 'Authentication is required.', request.id);
    return null;
  }
  return authenticated.context;
}

function requireOrigin(request: FastifyRequest, reply: FastifyReply, expected: string): boolean {
  try {
    assertAllowedOrigin(request.headers.origin, expected);
    return true;
  } catch (error) {
    if (error instanceof OriginNotAllowedError) {
      sendError(reply, 403, 'origin_not_allowed', 'This request origin is not allowed.', request.id);
      return false;
    }
    throw error;
  }
}

function handleFamilyError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (error instanceof FamilyForbiddenError) {
    return sendError(reply, 403, 'forbidden', error.message, request.id);
  }
  if (error instanceof MemberAlreadyExistsError) {
    return sendError(reply, 409, 'member_already_exists', error.message, request.id);
  }
  if (error instanceof LoginNameConflictError) {
    return sendError(reply, 409, 'login_name_conflict', error.message, request.id);
  }
  throw error;
}

function isSupportedIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function registerFamilyRoutes(app: FastifyInstance, dependencies: FamilyRouteDependencies): void {
  app.get('/api/family', async (request, reply) => {
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    try {
      return reply.send(await dependencies.familyService.getFamily(context));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.patch('/api/family', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    const parsed = UpdateFamilyInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', 'The family update is invalid.', request.id);
    if (parsed.data.timezone && !isSupportedIanaTimeZone(parsed.data.timezone)) {
      return sendError(reply, 400, 'validation_failed', 'The family timezone is not supported.', request.id);
    }
    try {
      return reply.send(await dependencies.familyService.updateFamily(context, parsed.data, request.id));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.get('/api/baby', async (request, reply) => {
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    try {
      return reply.send(await dependencies.familyService.getBaby(context));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.patch('/api/baby', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    const parsed = UpdateBabyInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', 'The baby update is invalid.', request.id);
    try {
      return reply.send(await dependencies.familyService.updateBaby(context, parsed.data, request.id));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.get('/api/family/members', async (request, reply) => {
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    try {
      return reply.send(await dependencies.familyService.listMembers(context));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.post('/api/family/members', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    const parsed = CreateNannyInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', 'The member request is invalid.', request.id);
    try {
      return reply.code(201).send(await dependencies.familyService.createNanny(context, parsed.data, request.id));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.patch('/api/family/members/:membershipId/status', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    const parsed = UpdateMemberStatusInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', 'The member status request is invalid.', request.id);
    const membershipId = (request.params as { membershipId: string }).membershipId;
    try {
      return reply.send(await dependencies.familyService.setNannyStatus(context, membershipId, parsed.data.status, request.id));
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });

  app.post('/api/family/members/:membershipId/reset-password', async (request, reply) => {
    if (!requireOrigin(request, reply, dependencies.appOrigin)) return;
    const context = await requireAuth(request, reply, dependencies.authService);
    if (!context) return;
    const parsed = ResetNannyPasswordInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'validation_failed', 'The password reset request is invalid.', request.id);
    const membershipId = (request.params as { membershipId: string }).membershipId;
    try {
      await dependencies.familyService.resetNannyPassword(context, membershipId, parsed.data.newPassword, request.id);
      return reply.code(204).send();
    } catch (error) {
      return handleFamilyError(reply, request, error);
    }
  });
}
