import { describe, expect, it, vi } from 'vitest';

interface PasswordModule {
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
}

interface SessionTokenModule {
  createSessionToken?: () => { raw: string; hash: string };
}

interface OriginGuardModule {
  assertAllowedOrigin?: (origin: string | undefined, expectedOrigin: string) => void;
}

interface LoginLimiter {
  allow: (key: string) => boolean;
}

interface LoginLimiterModule {
  createLoginLimiter?: (options: {
    limit: number;
    windowMs: number;
    now: () => number;
  }) => LoginLimiter;
}

async function importOptional<T>(path: string): Promise<Partial<T>> {
  try {
    return await vi.importActual<T>(path);
  } catch {
    return {};
  }
}

describe('M1 security primitives', () => {
  it('hashes and verifies passwords with an Argon2id encoded hash', async () => {
    const password = await importOptional<PasswordModule>('../src/auth/password.js');
    expect(password.hashPassword).toBeTypeOf('function');
    expect(password.verifyPassword).toBeTypeOf('function');

    const encoded = await password.hashPassword!('xiangxiang-test-password');
    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(encoded).not.toContain('xiangxiang-test-password');
    await expect(password.verifyPassword!(encoded, 'xiangxiang-test-password')).resolves.toBe(true);
    await expect(password.verifyPassword!(encoded, 'wrong-password')).resolves.toBe(false);
  });

  it('creates opaque random session tokens and stores only SHA-256-shaped hashes', async () => {
    const session = await importOptional<SessionTokenModule>('../src/auth/session-token.js');
    expect(session.createSessionToken).toBeTypeOf('function');

    const first = session.createSessionToken!();
    const second = session.createSessionToken!();
    expect(first.raw).not.toBe(first.hash);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.raw.length).toBeGreaterThanOrEqual(40);
    expect(first.raw).not.toBe(second.raw);
    expect(first.hash).not.toBe(second.hash);
  });

  it('accepts only the exact configured browser origin', async () => {
    const origin = await importOptional<OriginGuardModule>('../src/auth/origin-guard.js');
    expect(origin.assertAllowedOrigin).toBeTypeOf('function');

    expect(() => origin.assertAllowedOrigin!('http://127.0.0.1:8080', 'http://127.0.0.1:8080')).not.toThrow();
    expect(() => origin.assertAllowedOrigin!(undefined, 'http://127.0.0.1:8080')).toThrow();
    expect(() => origin.assertAllowedOrigin!('http://127.0.0.1:8081', 'http://127.0.0.1:8080')).toThrow();
    expect(() => origin.assertAllowedOrigin!('https://127.0.0.1:8080', 'http://127.0.0.1:8080')).toThrow();
  });

  it('limits the 11th login attempt in a 60-second window and forgets expired attempts', async () => {
    const limiterModule = await importOptional<LoginLimiterModule>('../src/auth/login-limiter.js');
    expect(limiterModule.createLoginLimiter).toBeTypeOf('function');

    let now = 1_000;
    const limiter = limiterModule.createLoginLimiter!({
      limit: 10,
      windowMs: 60_000,
      now: () => now,
    });

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(limiter.allow('client-a'), `attempt ${attempt}`).toBe(true);
    }
    expect(limiter.allow('client-a')).toBe(false);
    expect(limiter.allow('client-b')).toBe(true);

    now += 60_001;
    expect(limiter.allow('client-a')).toBe(true);
  });
});
