import type { FastifyInstance } from 'fastify';

import { VoiceCareContractError } from '@baby-care/contracts';
import type { VoiceCareIntentService } from '../voice-care/intent-service.js';

const VOICE_CARE_MEDIA_TYPE = 'application/vnd.baby-care.voice-intent+json';
const VOICE_CARE_BODY_LIMIT_BYTES = 16_384;
const VOICE_CARE_DEADLINE_MS = 30_000;

export function registerVoiceCareDeviceRoute(
  app: FastifyInstance,
  dependencies: { intentService: VoiceCareIntentService; now?: () => Date },
): void {
  app.addContentTypeParser(
    VOICE_CARE_MEDIA_TYPE,
    { parseAs: 'buffer', bodyLimit: VOICE_CARE_BODY_LIMIT_BYTES },
    (_request, body, done) => done(null, body),
  );
  app.post('/api/voice-care/intents', async (request, reply) => {
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(415).send({ code: 'rejected', traceId: request.id });
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, VOICE_CARE_DEADLINE_MS);
    request.raw.once('aborted', abort);
    try {
      const semantic = await dependencies.intentService.accept(
        request.body,
        (dependencies.now ?? (() => new Date()))(),
        controller.signal,
      );
      return reply.send(semantic);
    } catch (error) {
      if (error instanceof VoiceCareContractError) {
        return reply.code(400).send({ code: 'rejected', traceId: request.id });
      }
      return reply.send({
        schemaVersion: 1,
        code: 'temporarily_unavailable',
        careSessionId: null,
        careEventId: null,
        sessionVersion: null,
        proposalDigest: null,
        warningDigest: null,
        warningCodes: [],
        readback: null,
      });
    } finally {
      clearTimeout(timer);
      request.raw.off('aborted', abort);
    }
  });
}
