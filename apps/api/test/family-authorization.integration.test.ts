import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-test-setup-secret';
let database: DatabaseContext | undefined;

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected session cookie pair');
  return pair;
}

async function createApp() {
  database = createDatabase(testDatabaseUrl!);
  await database.migrate();
  await database.pool.query('truncate table audit_events, sessions, babies, family_memberships, users, families restart identity cascade');
  const app = buildApp({
    checkDatabase: database.checkDatabase,
    database,
    appOrigin: APP_ORIGIN,
    setupToken: SETUP_TOKEN,
    sessionSecure: false,
    now: () => new Date('2026-08-13T08:00:00.000Z'),
  });
  const setup = await app.inject({
    method: 'POST', url: '/api/setup',
    headers: { origin: APP_ORIGIN, 'x-baby-care-setup-token': SETUP_TOKEN },
    payload: {
      familyName: 'Xiangxiang Family', babyDisplayName: 'xiangxiang',
      dad: { loginName: 'dad', password: 'dad-test-password' },
      mom: { loginName: 'mom', password: 'mom-test-password' },
    },
  });
  expect(setup.statusCode).toBe(201);
  return app;
}

async function login(app: Awaited<ReturnType<typeof createApp>>, loginName: string, password: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: APP_ORIGIN }, payload: { loginName, password } });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response as unknown as { headers: Record<string, unknown> });
}

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

describeDatabase('M1 family authorization API', () => {
  it('allows Dad admin writes and keeps Nanny read-only', async () => {
    const app = await createApp();
    const dadCookie = await login(app, 'dad', 'dad-test-password');

    const family = await app.inject({ method: 'GET', url: '/api/family', headers: { cookie: dadCookie } });
    expect(family.statusCode).toBe(200);
    expect(family.json()).toMatchObject({ name: 'Xiangxiang Family', timezone: 'Asia/Shanghai' });

    const baby = await app.inject({ method: 'GET', url: '/api/baby', headers: { cookie: dadCookie } });
    expect(baby.statusCode).toBe(200);
    expect(baby.json()).toMatchObject({ displayName: 'xiangxiang', birthDate: null });

    const created = await app.inject({
      method: 'POST', url: '/api/family/members',
      headers: { origin: APP_ORIGIN, cookie: dadCookie },
      payload: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' },
    });
    expect(created.statusCode).toBe(201);
    const nannyMembershipId = created.json().membershipId as string;

    const nannyCookie = await login(app, 'nanny', 'nanny-test-password');
    const nannyFamily = await app.inject({ method: 'GET', url: '/api/family', headers: { cookie: nannyCookie } });
    expect(nannyFamily.statusCode).toBe(200);
    const nannyBaby = await app.inject({ method: 'GET', url: '/api/baby', headers: { cookie: nannyCookie } });
    expect(nannyBaby.statusCode).toBe(200);
    const nannyMembers = await app.inject({ method: 'GET', url: '/api/family/members', headers: { cookie: nannyCookie } });
    expect(nannyMembers.statusCode).toBe(200);
    expect(nannyMembers.json()[0]).not.toHaveProperty('loginName');

    const nannyFamilyPatch = await app.inject({
      method: 'PATCH', url: '/api/family', headers: { origin: APP_ORIGIN, cookie: nannyCookie }, payload: { name: 'Forbidden Change' },
    });
    expect(nannyFamilyPatch.statusCode).toBe(403);
    expect(nannyFamilyPatch.json()).toMatchObject({ code: 'forbidden' });

    const nannyBabyPatch = await app.inject({
      method: 'PATCH', url: '/api/baby', headers: { origin: APP_ORIGIN, cookie: nannyCookie }, payload: { displayName: 'not-allowed' },
    });
    expect(nannyBabyPatch.statusCode).toBe(403);

    const nannyCreateMember = await app.inject({
      method: 'POST', url: '/api/family/members', headers: { origin: APP_ORIGIN, cookie: nannyCookie },
      payload: { loginName: 'another', displayName: 'Another', password: 'another-test-password' },
    });
    expect(nannyCreateMember.statusCode).toBe(403);

    const dadFamilyPatch = await app.inject({
      method: 'PATCH', url: '/api/family', headers: { origin: APP_ORIGIN, cookie: dadCookie }, payload: { name: 'Xiangxiang Home', timezone: 'Asia/Shanghai' },
    });
    expect(dadFamilyPatch.statusCode).toBe(200);
    expect(dadFamilyPatch.json()).toMatchObject({ name: 'Xiangxiang Home' });

    const dadBabyPatch = await app.inject({
      method: 'PATCH', url: '/api/baby', headers: { origin: APP_ORIGIN, cookie: dadCookie }, payload: { displayName: 'xiangxiang', birthDate: '2026-09-10' },
    });
    expect(dadBabyPatch.statusCode).toBe(200);
    expect(dadBabyPatch.json()).toMatchObject({ birthDate: '2026-09-10' });

    expect(nannyMembershipId).toMatch(/[0-9a-f-]{36}/);
    await app.close();
  });

  it('lets Dad reset Nanny credentials but not another family admin', async () => {
    const app = await createApp();
    const dadCookie = await login(app, 'dad', 'dad-test-password');
    const created = await app.inject({
      method: 'POST', url: '/api/family/members', headers: { origin: APP_ORIGIN, cookie: dadCookie },
      payload: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' },
    });
    const nannyMembershipId = created.json().membershipId as string;
    const nannyCookie = await login(app, 'nanny', 'nanny-test-password');

    const reset = await app.inject({
      method: 'POST', url: `/api/family/members/${nannyMembershipId}/reset-password`,
      headers: { origin: APP_ORIGIN, cookie: dadCookie }, payload: { newPassword: 'nanny-next-password' },
    });
    expect(reset.statusCode).toBe(204);
    const oldNannySession = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: nannyCookie } });
    expect(oldNannySession.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: APP_ORIGIN }, payload: { loginName: 'nanny', password: 'nanny-next-password' } })).statusCode).toBe(200);

    const members = await app.inject({ method: 'GET', url: '/api/family/members', headers: { cookie: dadCookie } });
    const mom = members.json().find((member: { relationship: string }) => member.relationship === 'mom');
    const resetMom = await app.inject({
      method: 'POST', url: `/api/family/members/${mom.membershipId}/reset-password`,
      headers: { origin: APP_ORIGIN, cookie: dadCookie }, payload: { newPassword: 'mom-next-password' },
    });
    expect(resetMom.statusCode).toBe(403);
    expect(resetMom.json()).toMatchObject({ code: 'forbidden' });

    await app.close();
  });
});
