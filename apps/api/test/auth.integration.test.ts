import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-test-setup-secret';

let database: DatabaseContext | undefined;

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error('expected set-cookie header');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected session cookie pair');
  expect(pair).toMatch(/^baby_care_session=/);
  return pair;
}

async function createInitializedApp() {
  database = createDatabase(testDatabaseUrl!);
  await database.migrate();
  await database.pool.query(
    'truncate table audit_events, sessions, babies, family_memberships, users, families restart identity cascade',
  );

  const dependencies = {
    checkDatabase: database.checkDatabase,
    database,
    appOrigin: APP_ORIGIN,
    setupToken: SETUP_TOKEN,
    sessionSecure: false,
    now: () => new Date('2026-08-13T07:30:00.000Z'),
  } as unknown as Parameters<typeof buildApp>[0];
  const app = buildApp(dependencies);

  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    headers: { origin: APP_ORIGIN, 'x-baby-care-setup-token': SETUP_TOKEN },
    payload: {
      familyName: 'Xiangxiang Family',
      babyDisplayName: 'xiangxiang',
      dad: { loginName: 'dad', password: 'dad-test-password' },
      mom: { loginName: 'mom', password: 'mom-test-password' },
    },
  });
  expect(setup.statusCode).toBe(201);

  return app;
}

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

describeDatabase('M1 server-side sessions', () => {
  it('returns the same invalid-credentials envelope for unknown user and wrong password', async () => {
    const app = await createInitializedApp();

    for (const payload of [
      { loginName: 'missing-user', password: 'wrong-password' },
      { loginName: 'dad', password: 'wrong-password' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin: APP_ORIGIN },
        payload,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'invalid_credentials' });
    }

    await app.close();
  });

  it('creates an opaque cookie session, exposes safe identity, and revokes it on logout', async () => {
    const app = await createInitializedApp();

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN },
      payload: { loginName: 'dad', password: 'dad-test-password' },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookie = cookieValue(setCookie);
    expect(String(setCookie)).toContain('HttpOnly');
    expect(String(setCookie)).toContain('SameSite=Lax');

    const rawToken = cookie.split('=')[1]!;
    const sessionRows = await database!.pool.query<{ token_hash: string }>(
      'select token_hash from sessions where revoked_at is null',
    );
    expect(sessionRows.rows).toHaveLength(1);
    expect(sessionRows.rows[0]!.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionRows.rows[0]!.token_hash).not.toBe(rawToken);

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      userId: expect.any(String),
      displayName: 'Dad',
      relationship: 'dad',
      permissionLevel: 'family_admin',
      familyId: expect.any(String),
      familyName: 'Xiangxiang Family',
      babyId: expect.any(String),
      babyDisplayName: 'xiangxiang',
    });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: APP_ORIGIN, cookie },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json()).toMatchObject({ code: 'unauthenticated' });

    await app.close();
  });

  it('rotates the current session on password change and rejects the old cookie', async () => {
    const app = await createInitializedApp();

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN },
      payload: { loginName: 'dad', password: 'dad-test-password' },
    });
    const oldCookie = cookieValue(login.headers['set-cookie']);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { origin: APP_ORIGIN, cookie: oldCookie },
      payload: { currentPassword: 'dad-test-password', newPassword: 'dad-next-password' },
    });
    expect(changed.statusCode).toBe(204);
    const newCookie = cookieValue(changed.headers['set-cookie']);
    expect(newCookie).not.toBe(oldCookie);

    const oldSession = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: oldCookie } });
    expect(oldSession.statusCode).toBe(401);
    const newSession = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: newCookie } });
    expect(newSession.statusCode).toBe(200);

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN },
      payload: { loginName: 'dad', password: 'dad-test-password' },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);
    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN },
      payload: { loginName: 'dad', password: 'dad-next-password' },
    });
    expect(newPasswordLogin.statusCode).toBe(200);

    await app.close();
  });

  it('invalidates an otherwise live session when the membership is disabled', async () => {
    const app = await createInitializedApp();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: APP_ORIGIN },
      payload: { loginName: 'dad', password: 'dad-test-password' },
    });
    const cookie = cookieValue(login.headers['set-cookie']);

    await database!.pool.query(
      `update family_memberships set status = 'disabled' where relationship = 'dad'`,
    );

    const session = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
    expect(session.statusCode).toBe(401);
    expect(session.json()).toMatchObject({ code: 'unauthenticated' });

    await app.close();
  });
});
