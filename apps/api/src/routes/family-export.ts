import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { can } from '@baby-care/domain';
import type { ApiErrorCode } from '@baby-care/contracts';
import type { AuthContext, AuthService } from '../auth/auth-service.js';
import { assertAllowedOrigin, OriginNotAllowedError } from '../auth/origin-guard.js';
import { readSessionCookie } from '../auth/session-auth.js';
import { writeAudit } from '../audit/audit-repository.js';
import type { DatabaseContext } from '../db.js';
import {
  FamilyExportTooLargeError,
  type FamilyExportService,
} from '../family/family-export-service.js';
import {
  ExportInProgressError,
  type ExportCoordinator,
} from '../family/export-coordinator.js';

export interface FamilyExportRouteDependencies {
  authService: AuthService;
  exportService: FamilyExportService;
  coordinator: ExportCoordinator;
  database: DatabaseContext;
  appOrigin: string;
  now: () => Date;
}

function sendError(reply: FastifyReply, statusCode: number, code: ApiErrorCode, message: string, traceId: string) {
  return reply.code(statusCode).send({ code, message, traceId });
}

async function requireExportAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: FamilyExportRouteDependencies,
): Promise<AuthContext | null> {
  try {
    assertAllowedOrigin(request.headers.origin, dependencies.appOrigin);
  } catch (error) {
    if (error instanceof OriginNotAllowedError) {
      sendError(reply, 403, 'origin_not_allowed', 'This request origin is not allowed.', request.id);
      return null;
    }
    throw error;
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
  if (!can(authenticated.context.permissionLevel, 'family.export')) {
    sendError(reply, 403, 'forbidden', 'This family operation is not allowed.', request.id);
    return null;
  }
  return authenticated.context;
}

async function recordExportAudit(
  database: DatabaseContext,
  context: AuthContext,
  traceId: string,
  occurredAt: Date,
): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await writeAudit(client, {
      familyId: context.familyId,
      actorUserId: context.userId,
      actorMembershipId: context.membershipId,
      action: 'family.export',
      targetType: 'family',
      targetId: context.familyId,
      source: 'web',
      traceId,
      metadata: null,
      occurredAt,
    });
    await client.query('commit');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Preserve the closed audit failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

function filename(now: Date): string {
  return `baby-care-export-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}.json`;
}

export function registerFamilyExportRoute(
  app: FastifyInstance,
  dependencies: FamilyExportRouteDependencies,
): void {
  app.post('/api/family/export', async (request, reply) => {
    const context = await requireExportAuth(request, reply, dependencies);
    if (!context) return;
    try {
      await dependencies.coordinator.run(context.userId, async () => {
        const generatedAt = dependencies.now();
        const result = await dependencies.exportService.exportFamily(context, generatedAt);
        if (!Buffer.isBuffer(result.serialized)) throw new Error('invalid export buffer');
        await recordExportAudit(dependencies.database, context, request.id, generatedAt);
        reply
          .type('application/json')
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .header('content-disposition', `attachment; filename="${filename(generatedAt)}"`)
          .send(result.serialized);
      });
    } catch (error) {
      if (error instanceof ExportInProgressError) {
        return sendError(reply, 409, 'export_in_progress', 'An export is already in progress.', request.id);
      }
      if (error instanceof FamilyExportTooLargeError) {
        return sendError(reply, 413, 'export_too_large', 'The family export is too large.', request.id);
      }
      return sendError(reply, 500, 'export_failed', 'The family export could not be completed.', request.id);
    }
  });
}
