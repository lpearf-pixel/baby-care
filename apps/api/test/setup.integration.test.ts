import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

let database: DatabaseContext | undefined;

const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-test-setup-secret';
const setupPayload = {
  familyName: 'Xiangxiang Family',
  babyDisplayName: 'xiangxiang',
  dad: { loginName: 'dad', password: 'dad-test-password' },
  mom: { loginName: 'mom', password: 'mom-test-password' },
};

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

async function createSetupApp() {
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
    now: () => new Date('2026-08-13T07:00:00.000Z'),
  } as unknown as Parameters<typeof buildApp>[0];

  return buildApp(dependencies);
}

describeDatabase('M1 one-time family setup', () => {
  it('reports setup required without exposing family details', async () => {
    const app = await createSetupApp();
    const response = await app.inject({ method: 'GET', url: '/api/setup/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ required: true });
    await app.close();
  });

  it('creates Family, xiangxiang, Dad, Mom, memberships and audit exactly once', async () => {
    const app = await createSetupApp();

    const first = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: {
        origin: APP_ORIGIN,
        'x-baby-care-setup-token': SETUP_TOKEN,
        'x-trace-id': 'setup-trace-001',
      },
      payload: setupPayload,
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ status: 'created' });

    const family = await database!.pool.query('select name, timezone, status from families');
    expect(family.rows).toEqual([
      { name: 'Xiangxiang Family', timezone: 'Asia/Shanghai', status: 'active' },
    ]);

    const baby = await database!.pool.query('select display_name, birth_date from babies');
    expect(baby.rows).toEqual([{ display_name: 'xiangxiang', birth_date: null }]);

    const users = await database!.pool.query(
      `select u.login_name, u.display_name, fm.relationship, fm.permission_level
       from users u
       join family_memberships fm on fm.user_id = u.id
       order by u.login_name`,
    );
    expect(users.rows).toEqual([
      { login_name: 'dad', display_name: 'Dad', relationship: 'dad', permission_level: 'family_admin' },
      { login_name: 'mom', display_name: 'Mom', relationship: 'mom', permission_level: 'family_admin' },
    ]);

    const passwordRows = await database!.pool.query<{ password_hash: string }>('select password_hash from users');
    for (const row of passwordRows.rows) {
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain('test-password');
    }

    const audit = await database!.pool.query(
      `select action, source, trace_id, metadata_json from audit_events`,
    );
    expect(audit.rows).toEqual([
      {
        action: 'family.setup_completed',
        source: 'api',
        trace_id: 'setup-trace-001',
        metadata_json: null,
      },
    ]);

    const second = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: {
        origin: APP_ORIGIN,
        'x-baby-care-setup-token': 'wrong-but-irrelevant-token',
      },
      payload: setupPayload,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'setup_closed' });

    await app.close();
  });

  it('rejects missing origin and invalid setup token without creating partial state', async () => {
    const app = await createSetupApp();

    const noOrigin = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { 'x-baby-care-setup-token': SETUP_TOKEN },
      payload: setupPayload,
    });
    expect(noOrigin.statusCode).toBe(403);
    expect(noOrigin.json()).toMatchObject({ code: 'origin_not_allowed' });

    const badToken = await app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: { origin: APP_ORIGIN, 'x-baby-care-setup-token': 'invalid-setup-token' },
      payload: setupPayload,
    });
    expect(badToken.statusCode).toBe(403);
    expect(badToken.json()).toMatchObject({ code: 'setup_token_invalid' });

    const counts = await database!.pool.query(
      `select
        (select count(*)::int from families) as families,
        (select count(*)::int from users) as users,
        (select count(*)::int from babies) as babies`,
    );
    expect(counts.rows[0]).toEqual({ families: 0, users: 0, babies: 0 });

    await app.close();
  });
});
