import { describe, expect, it } from 'vitest';
import { DEFAULT_FAMILY_EXPORT_MAX_BYTES, loadConfig } from '../src/config.js';

const baseEnvironment = {
  DATABASE_URL: 'postgres://example/test',
  BABY_CARE_APP_ORIGIN: 'http://127.0.0.1:8080',
  BABY_CARE_SETUP_TOKEN: 'local-development-setup-token-change-me',
};

describe('production API configuration', () => {
  it.each([
    ['true', true],
    ['false', false],
  ] as const)('parses SESSION_SECURE=%s as %s', (raw, expected) => {
    expect(loadConfig({ ...baseEnvironment, SESSION_SECURE: raw }).SESSION_SECURE).toBe(expected);
  });

  it('requires an explicit SESSION_SECURE value', () => {
    expect(() => loadConfig(baseEnvironment)).toThrow();
  });

  it.each(['FALSE', 'yes', '1', ''])('rejects invalid SESSION_SECURE=%j', (raw) => {
    expect(() => loadConfig({ ...baseEnvironment, SESSION_SECURE: raw })).toThrow();
  });

  it('uses the exact 32 MiB default export bound and accepts a positive bounded override', () => {
    expect(DEFAULT_FAMILY_EXPORT_MAX_BYTES).toBe(33_554_432);
    expect(loadConfig({ ...baseEnvironment, SESSION_SECURE: 'false' }).FAMILY_EXPORT_MAX_BYTES).toBe(33_554_432);
    expect(loadConfig({ ...baseEnvironment, SESSION_SECURE: 'false', FAMILY_EXPORT_MAX_BYTES: '1048576' }).FAMILY_EXPORT_MAX_BYTES).toBe(1_048_576);
  });

  it.each(['0', '-1', 'not-a-number', '9007199254740992', '134217729'])('fails closed for invalid export bounds: %s', (raw) => {
    expect(() => loadConfig({ ...baseEnvironment, SESSION_SECURE: 'false', FAMILY_EXPORT_MAX_BYTES: raw })).toThrow();
  });
});
