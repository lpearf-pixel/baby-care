import { describe, expect, it } from 'vitest';
import * as contractsModule from '../src/index.js';

interface SetupContractModule {
  SetupInputSchema?: {
    safeParse: (value: unknown) => { success: boolean };
  };
  ApiErrorSchema?: {
    safeParse: (value: unknown) => { success: boolean };
  };
}

const contracts = contractsModule as unknown as SetupContractModule;

describe('M1 shared contracts', () => {
  it('accepts the one-family setup payload and rejects short passwords', () => {
    expect(contracts.SetupInputSchema).toBeDefined();

    const valid = {
      familyName: 'Xiangxiang Family',
      babyDisplayName: 'xiangxiang',
      dad: { loginName: 'dad', password: 'dad-test-password' },
      mom: { loginName: 'mom', password: 'mom-test-password' },
    };

    expect(contracts.SetupInputSchema!.safeParse(valid).success).toBe(true);
    expect(
      contracts.SetupInputSchema!.safeParse({
        ...valid,
        dad: { loginName: 'dad', password: 'short' },
      }).success,
    ).toBe(false);
  });

  it('defines a strict machine-readable API error envelope', () => {
    expect(contracts.ApiErrorSchema).toBeDefined();
    expect(
      contracts.ApiErrorSchema!.safeParse({
        code: 'setup_closed',
        message: 'Setup is already complete.',
        traceId: 'trace-123',
      }).success,
    ).toBe(true);
    expect(
      contracts.ApiErrorSchema!.safeParse({
        code: 'setup_closed',
        message: 'Setup is already complete.',
        traceId: 'trace-123',
        secret: 'must-not-be-allowed',
      }).success,
    ).toBe(false);
  });
});
