import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

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
});
