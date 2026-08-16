import { describe, expect, it } from 'vitest';
import * as contractsModule from '../src/index.js';

interface SchemaLike {
  safeParse: (value: unknown) => { success: boolean };
}

interface M1ContractModule {
  SetupInputSchema?: SchemaLike;
  ApiErrorSchema?: SchemaLike;
  UpdateFamilyInputSchema?: SchemaLike;
  FamilyDtoSchema?: SchemaLike;
  UpdateBabyInputSchema?: SchemaLike;
  CreateNannyInputSchema?: SchemaLike;
  UpdateMemberStatusInputSchema?: SchemaLike;
  ResetNannyPasswordInputSchema?: SchemaLike;
}

const contracts = contractsModule as unknown as M1ContractModule;

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
    expect(contracts.SetupInputSchema!.safeParse({ ...valid, dad: { loginName: 'dad', password: 'short' } }).success).toBe(false);
  });

  it('defines a strict machine-readable API error envelope', () => {
    expect(contracts.ApiErrorSchema).toBeDefined();
    expect(contracts.ApiErrorSchema!.safeParse({ code: 'setup_closed', message: 'Setup is already complete.', traceId: 'trace-123' }).success).toBe(true);
    expect(contracts.ApiErrorSchema!.safeParse({ code: 'setup_closed', message: 'Setup is already complete.', traceId: 'trace-123', secret: 'must-not-be-allowed' }).success).toBe(false);
  });

  it('defines strict family, baby, and Nanny mutation contracts', () => {
    for (const schema of [
      contracts.UpdateFamilyInputSchema,
      contracts.UpdateBabyInputSchema,
      contracts.CreateNannyInputSchema,
      contracts.UpdateMemberStatusInputSchema,
      contracts.ResetNannyPasswordInputSchema,
    ]) expect(schema).toBeDefined();

    expect(contracts.UpdateFamilyInputSchema!.safeParse({ name: 'Xiangxiang Home', timezone: 'Asia/Shanghai' }).success).toBe(true);
    expect(contracts.UpdateFamilyInputSchema!.safeParse({ timezone: 'Not/A_Real_Zone' }).success).toBe(false);
    expect(contracts.FamilyDtoSchema!.safeParse({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Legacy Family',
      timezone: 'Not/A_Real_Zone',
      status: 'active',
    }).success).toBe(false);
    expect(contracts.UpdateBabyInputSchema!.safeParse({ displayName: 'xiangxiang', birthDate: '2026-09-10' }).success).toBe(true);
    expect(contracts.CreateNannyInputSchema!.safeParse({ loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' }).success).toBe(true);
    expect(contracts.UpdateMemberStatusInputSchema!.safeParse({ status: 'disabled' }).success).toBe(true);
    expect(contracts.ResetNannyPasswordInputSchema!.safeParse({ newPassword: 'nanny-next-password' }).success).toBe(true);

    expect(contracts.CreateNannyInputSchema!.safeParse({ loginName: 'nanny', displayName: 'Nanny', password: 'short' }).success).toBe(false);
    expect(contracts.UpdateMemberStatusInputSchema!.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});
