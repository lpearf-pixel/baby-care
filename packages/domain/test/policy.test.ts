import { describe, expect, it } from 'vitest';
import * as domainModule from '../src/index.js';

type PermissionLevel = 'family_admin' | 'caregiver';
type Capability =
  | 'family.read'
  | 'family.update'
  | 'baby.read'
  | 'baby.update'
  | 'members.read'
  | 'members.manage'
  | 'credentials.reset_nanny';
type Can = (permission: PermissionLevel, capability: Capability) => boolean;

const domain = domainModule as unknown as { can?: Can };

function requireCan(): Can {
  expect(domain.can).toBeTypeOf('function');
  return domain.can!;
}

describe('M1 permission policy', () => {
  it('allows family admins to perform all M1 family capabilities', () => {
    const can = requireCan();
    for (const capability of [
      'family.read',
      'family.update',
      'baby.read',
      'baby.update',
      'members.read',
      'members.manage',
      'credentials.reset_nanny',
    ] as const) {
      expect(can('family_admin', capability), capability).toBe(true);
    }
  });

  it('limits caregivers to the read-only family context needed for care handoff', () => {
    const can = requireCan();
    expect(can('caregiver', 'family.read')).toBe(true);
    expect(can('caregiver', 'baby.read')).toBe(true);
    expect(can('caregiver', 'members.read')).toBe(true);
    expect(can('caregiver', 'family.update')).toBe(false);
    expect(can('caregiver', 'baby.update')).toBe(false);
    expect(can('caregiver', 'members.manage')).toBe(false);
    expect(can('caregiver', 'credentials.reset_nanny')).toBe(false);
  });
});
