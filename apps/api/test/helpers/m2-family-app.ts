import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db.js';

export const M2_TEST_ORIGIN = 'http://127.0.0.1:8080';
export const M2_TEST_NOW = new Date('2026-08-13T08:00:00.000Z');
const SETUP_TOKEN = 'local-test-setup-secret';

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected session cookie pair');
  return pair;
}

export async function createM2TestApp(testDatabaseUrl: string) {
  const database = createDatabase(testDatabaseUrl);
  await database.migrate();
  await database.pool.query(`truncate table
    care_event_revisions, measurements, care_actions, sleep_intervals, diaper_events,
    feeding_components, feeding_sessions, care_events, audit_events, sessions, babies,
    family_memberships, users, families restart identity cascade`);

  const app = buildApp({
    checkDatabase: database.checkDatabase,
    database,
    appOrigin: M2_TEST_ORIGIN,
    setupToken: SETUP_TOKEN,
    sessionSecure: false,
    now: () => M2_TEST_NOW,
  });

  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    headers: { origin: M2_TEST_ORIGIN, 'x-baby-care-setup-token': SETUP_TOKEN },
    payload: {
      familyName: 'Xiangxiang Family',
      babyDisplayName: 'xiangxiang',
      dad: { loginName: 'dad', password: 'dad-test-password' },
      mom: { loginName: 'mom', password: 'mom-test-password' },
    },
  });
  expect(setup.statusCode).toBe(201);

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: M2_TEST_ORIGIN },
    payload: { loginName: 'dad', password: 'dad-test-password' },
  });
  expect(login.statusCode).toBe(200);

  return {
    app,
    database,
    cookie: sessionCookie(login as unknown as { headers: Record<string, unknown> }),
  };
}

export function postFeeding(app: FastifyInstance, cookie: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/care/feeding-sessions',
    headers: { origin: M2_TEST_ORIGIN, cookie },
    payload,
  });
}
