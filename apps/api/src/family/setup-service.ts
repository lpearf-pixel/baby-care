import type { SetupInput } from '@baby-care/contracts';
import { hashPassword } from '../auth/password.js';
import type { FamilyRepository } from './family-repository.js';

export interface SetupService {
  isRequired(): Promise<boolean>;
  initialize(input: SetupInput, traceId: string): Promise<void>;
}

export function createSetupService(
  repository: FamilyRepository,
  now: () => Date = () => new Date(),
): SetupService {
  return {
    async isRequired(): Promise<boolean> {
      return !(await repository.isInitialized());
    },

    async initialize(input: SetupInput, traceId: string): Promise<void> {
      const [dadPasswordHash, momPasswordHash] = await Promise.all([
        hashPassword(input.dad.password),
        hashPassword(input.mom.password),
      ]);

      await repository.initialize({
        familyName: input.familyName,
        babyDisplayName: input.babyDisplayName,
        dadLoginName: input.dad.loginName,
        dadPasswordHash,
        momLoginName: input.mom.loginName,
        momPasswordHash,
        traceId,
        occurredAt: now(),
      });
    },
  };
}
