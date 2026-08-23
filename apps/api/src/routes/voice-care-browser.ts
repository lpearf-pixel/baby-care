import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PairVoiceCareDeviceInputSchema, type ApiErrorCode } from '@baby-care/contracts';
import { z } from 'zod';

import type { CareAuth } from '../care/care-auth.js';
import type { VoiceCareDeviceService } from '../voice-care/device-service.js';
import {
  VoiceCareForbiddenError,
  VoiceCareNotFoundError,
  VoiceCarePairingInvalidError,
  VoiceCareStateConflictError,
} from '../voice-care/errors.js';

const DeviceParamsSchema = z.object({ deviceId: z.string().uuid() }).strict();

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  traceId: string,
) {
  return reply.code(statusCode).send({ code, message, traceId });
}

function handleVoiceCareError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  if (error instanceof VoiceCareForbiddenError) {
    return sendError(reply, 403, 'forbidden', error.message, request.id);
  }
  if (error instanceof VoiceCarePairingInvalidError) {
    return sendError(reply, 409, 'voice_care_pairing_invalid', error.message, request.id);
  }
  if (error instanceof VoiceCareNotFoundError) {
    return sendError(reply, 404, 'voice_care_not_found', error.message, request.id);
  }
  if (error instanceof VoiceCareStateConflictError) {
    return sendError(reply, 409, 'voice_care_state_conflict', error.message, request.id);
  }
  return sendError(
    reply,
    503,
    'voice_care_state_conflict',
    'Voice Care is temporarily unavailable.',
    request.id,
  );
}

export function registerVoiceCareBrowserRoutes(
  app: FastifyInstance,
  dependencies: { careAuth: CareAuth; deviceService: VoiceCareDeviceService },
): void {
  app.post('/api/voice-care/pairing-challenges', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    try {
      return reply.code(201).send(await dependencies.deviceService.createChallenge(actor, request.id));
    } catch (error) {
      return handleVoiceCareError(reply, request, error);
    }
  });

  app.post('/api/voice-care/devices', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = PairVoiceCareDeviceInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_failed', 'Invalid Voice Care pairing input.', request.id);
    }
    try {
      return reply.code(201).send(await dependencies.deviceService.pair(actor, parsed.data, request.id));
    } catch (error) {
      return handleVoiceCareError(reply, request, error);
    }
  });

  app.get('/api/voice-care/devices', async (request, reply) => {
    const actor = await dependencies.careAuth.requireRead(request, reply);
    if (!actor) return;
    try {
      return reply.send(await dependencies.deviceService.list(actor));
    } catch (error) {
      return handleVoiceCareError(reply, request, error);
    }
  });

  app.delete('/api/voice-care/devices/:deviceId', async (request, reply) => {
    const actor = await dependencies.careAuth.requireWrite(request, reply);
    if (!actor) return;
    const parsed = DeviceParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return sendError(reply, 400, 'validation_failed', 'Invalid Voice Care device id.', request.id);
    }
    try {
      return reply.send(await dependencies.deviceService.revoke(actor, parsed.data.deviceId, request.id));
    } catch (error) {
      return handleVoiceCareError(reply, request, error);
    }
  });
}
