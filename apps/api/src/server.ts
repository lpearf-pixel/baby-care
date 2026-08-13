import Fastify, { type FastifyInstance } from 'fastify';
import { createHealthService, type HealthDependencies } from './health.ts';

export function buildServer(deps: HealthDependencies): FastifyInstance {
  const server = Fastify({ logger: false });
  const health = createHealthService(deps);
  server.get('/health/live', async (_request, reply) => {
    const result = health.live();
    return reply.code(result.statusCode).send(result.body);
  });
  server.get('/health/ready', async (_request, reply) => {
    const result = await health.ready();
    return reply.code(result.statusCode).send(result.body);
  });
  return server;
}
