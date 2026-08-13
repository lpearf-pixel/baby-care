import Fastify, { type FastifyInstance } from 'fastify';

export interface AppDependencies {
  checkDatabase: () => Promise<boolean>;
  now?: () => Date;
}

export function buildApp(_dependencies: AppDependencies): FastifyInstance {
  return Fastify({ logger: false });
}
