import { describe, expect, it } from 'vitest';
import { can } from '../src/policy.js';

describe('M2 care policy', () => {
  it('allows caregivers to read and write care without granting family administration', () => {
    expect(can('caregiver', 'care.read' as never)).toBe(true);
    expect(can('caregiver', 'care.write' as never)).toBe(true);
    expect(can('caregiver', 'family.update')).toBe(false);
  });
});
