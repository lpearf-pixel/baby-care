import { describe, expect, it } from 'vitest';
import { domainContractVersion } from '../src/index.js';

describe('@baby-care/domain', () => {
  it('stays a framework-free domain package boundary', () => {
    expect(domainContractVersion).toBe(1);
  });
});
