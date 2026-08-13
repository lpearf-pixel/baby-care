import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-test-setup-secret';
const CLIENT_IP = '203.0.113.10';
let database: DatabaseContext | undefined;

function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected set-cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected cookie pair');
  return pair;
}

async function createInitializedApp() {
  database = createDatabase(testDatabaseUrl!);
  await database.migrate();
  await database.pool.query(
    'truncate table audit_events, sessions, babies, family_memberships, users, families restart identity cascade',
  );
  const app = buildApp({
    checkDatabase: database.checkDatabase,
    database,
    appOrigin: APP_ORIGIN,
    setupToken: SETUP_TOKEN,
    sessionSecure: false,
    now: () => new Date('2026-08-13T08:30:00.000Z'),
  });

  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    headers: {
      origin: APP_ORIGIN,
      'x-baby-care-setup-token': SETUP_TOKEN,
      'x-trace-id': 'audit-setup',
    },
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

async function login(
  app: Awaited<ReturnType<typeof createInitializedApp>>,
  loginName: string,
  password: string,
  traceId: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: APP_ORIGIN, 'x-trace-id': traceId, 'x-forwarded-for': CLIENT_IP },
    payload: { loginName, password },
  });
  return response;
}

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

describeDatabase('M1 identity audit trail', () => {
  it('records every required identity/admin action without persisting secrets or client identifiers', async () => {
    const app = await createInitializedApp();

    const failed = await login(app, 'secret-missing-user', 'wrong-secret-password', 'audit-login-failed');
    expect(failed.statusCode).toBe(401);

    const dadLogin = await login(app, 'dad', 'dad-test-password', 'audit-login-success');
    expect(dadLogin.statusCode).toBe(200);
    let dadCookie = cookieFrom(dadLogin as unknown as { headers: Record<string, unknown> });

    const created = await app.inject({
      method: 'POST',
      url: '/api/family/members',
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-nanny-create' },
      payload: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' },
    });
    expect(created.statusCode).toBe(201);
    const nannyMembershipId = created.json().membershipId as string;

    const nannyLogin = await login(app, 'nanny', 'nanny-test-password', 'audit-nanny-login');
    expect(nannyLogin.statusCode).toBe(200);
    const nannyCookie = cookieFrom(nannyLogin as unknown as { headers: Record<string, unknown> });

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/family/members/${nannyMembershipId}/status`,
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-nanny-disable' },
      payload: { status: 'disabled' },
    });
    expect(disabled.statusCode).toBe(200);

    const enabled = await app.inject({
      method: 'PATCH',
      url: `/api/family/members/${nannyMembershipId}/status`,
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-nanny-enable' },
      payload: { status: 'active' },
    });
    expect(enabled.statusCode).toBe(200);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/family/members/${nannyMembershipId}/reset-password`,
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-nanny-reset' },
      payload: { newPassword: 'nanny-next-password' },
    });
    expect(reset.statusCode).toBe(204);

    const oldNannySession = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: nannyCookie } });
    expect(oldNannySession.statusCode).toBe(401);

    const familyUpdated = await app.inject({
      method: 'PATCH',
      url: '/api/family',
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-family-update' },
      payload: { name: 'Xiangxiang Home' },
    });
    expect(familyUpdated.statusCode).toBe(200);

    const babyUpdated = await app.inject({
      method: 'PATCH',
      url: '/api/baby',
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-baby-update' },
      payload: { birthDate: '2026-09-10' },
    });
    expect(babyUpdated.statusCode).toBe(200);

    const passwordChanged = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-password-change' },
      payload: { currentPassword: 'dad-test-password', newPassword: 'dad-next-password' },
    });
    expect(passwordChanged.statusCode).toBe(204);
    dadCookie = cookieFrom(passwordChanged as unknown as { headers: Record<string, unknown> });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { origin: APP_ORIGIN, cookie: dadCookie, 'x-trace-id': 'audit-logout' },
    });
    expect(logout.statusCode).toBe(204);

    const result = await database!.pool.query<{
      action: string;
      trace_id: string;
      actor_user_id: string | null;
      metadata_json: unknown;
    }>(`select action, trace_id, actor_user_id, metadata_json from audit_events order by occurred_at, id`);

    const actions = result.rows.map((row) => row.action);
    for (const expected of [
      'family.setup_completed',
      'auth.login_failed',
      'auth.login_succeeded',
      'member.nanny_created',
      'member.nanny_disabled',
      'member.nanny_enabled',
      'member.nanny_password_reset',
      'family.updated',
      'baby.updated',
      'auth.password_changed',
      'auth.logout',
    ]) {
      expect(actions, `missing audit action ${expected}`).toContain(expected);
    }

    const failedRow = result.rows.find((row) => row.action === 'auth.login_failed');
    expect(failedRow?.actor_user_id).toBeNull();
    expect(failedRow?.trace_id).toBe('audit-login-failed');

    const serialized = JSON.stringify(result.rows);
    for (const forbidden of [
      'dad-test-password',
      'dad-next-password',
      'nanny-test-password',
      'nanny-next-password',
      SETUP_TOKEN,
      CLIENT_IP,
      'secret-missing-user',
      'baby_care_session=',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    await app.close();
  });
});
