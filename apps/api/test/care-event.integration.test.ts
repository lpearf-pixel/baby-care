import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createAuthService, type AuthService } from '../src/auth/auth-service.js';
import { createDatabase, type DatabaseContext } from '../src/db.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const APP_ORIGIN = 'http://127.0.0.1:8080';
const SETUP_TOKEN = 'local-test-setup-secret';
const NOW = new Date('2026-08-13T08:00:00.000Z');
let database: DatabaseContext | undefined;

type CareActorContext = {
  userId: string;
  membershipId: string;
  familyId: string;
  babyId: string;
  relationship: 'dad' | 'mom' | 'nanny';
  permissionLevel: 'family_admin' | 'caregiver';
};

type CareAuth = {
  requireRead(request: FastifyRequest, reply: FastifyReply): Promise<CareActorContext | null>;
  requireWrite(request: FastifyRequest, reply: FastifyReply): Promise<CareActorContext | null>;
};

type CareEventRow = {
  id: string;
  familyId: string;
  babyId: string;
  actorUserId: string | null;
  actorMembershipId: string | null;
  eventType: string;
  status: 'active' | 'voided';
  version: number;
  clientRequestId: string | null;
};

type RepoModule = {
  createCareEvent(client: pg.PoolClient, input: {
    actor: CareActorContext;
    eventType: string;
    occurredAt: Date;
    clientRequestId: string;
    note?: string | null;
    traceId: string;
  }): Promise<CareEventRow>;
  findByClientRequestId(client: pg.PoolClient, actor: CareActorContext, clientRequestId: string): Promise<CareEventRow | null>;
  loadActiveCareEventForUpdate(client: pg.PoolClient, actor: CareActorContext, eventId: string): Promise<CareEventRow | null>;
  appendCareRevision(client: pg.PoolClient, input: {
    eventId: string;
    actor: CareActorContext;
    action: 'edit' | 'void';
    fromVersion: number;
    toVersion: number;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    traceId: string;
  }): Promise<void>;
  voidCareEvent(client: pg.PoolClient, input: {
    eventId: string;
    actor: CareActorContext;
    updatedAt: Date;
  }): Promise<CareEventRow | null>;
};

async function loadTask3Modules() {
  const careAuthPath = '../src/care/care-auth.js';
  const repositoryPath = '../src/care/care-event-repository.js';
  const errorsPath = '../src/care/care-errors.js';
  const careAuthModule = await import(careAuthPath).catch(() => null);
  const repositoryModule = await import(repositoryPath).catch(() => null);
  const errorsModule = await import(errorsPath).catch(() => null);

  expect(careAuthModule, 'care-auth module is missing').not.toBeNull();
  expect(repositoryModule, 'care-event-repository module is missing').not.toBeNull();
  expect(errorsModule, 'care-errors module is missing').not.toBeNull();
  if (!careAuthModule || !repositoryModule || !errorsModule) return null;

  expect(errorsModule.CareEventNotFoundError).toBeTypeOf('function');
  expect(errorsModule.CareStateConflictError).toBeTypeOf('function');
  expect(errorsModule.CareConfirmationRequiredError).toBeTypeOf('function');

  return {
    createCareAuth: careAuthModule.createCareAuth as (dependencies: { authService: AuthService; appOrigin: string }) => CareAuth,
    repository: repositoryModule as unknown as RepoModule,
  };
}

function sessionCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') throw new Error('expected session cookie');
  const pair = header.split(';', 1)[0];
  if (!pair) throw new Error('expected session cookie pair');
  return pair;
}

function rawSessionToken(cookie: string): string {
  const separator = cookie.indexOf('=');
  if (separator < 0) throw new Error('expected session cookie value');
  return decodeURIComponent(cookie.slice(separator + 1));
}

async function login(app: ReturnType<typeof buildApp>, loginName: string, password: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin: APP_ORIGIN },
    payload: { loginName, password },
  });
  expect(response.statusCode).toBe(200);
  return sessionCookie(response as unknown as { headers: Record<string, unknown> });
}

async function createReadyApp(createCareAuth: (dependencies: { authService: AuthService; appOrigin: string }) => CareAuth) {
  database = createDatabase(testDatabaseUrl!);
  await database.migrate();
  await database.pool.query(`truncate table
    care_event_revisions, measurements, care_actions, sleep_intervals, diaper_events,
    feeding_components, feeding_sessions, care_events, audit_events, sessions, babies,
    family_memberships, users, families restart identity cascade`);

  const app = buildApp({
    checkDatabase: database.checkDatabase,
    database,
    appOrigin: APP_ORIGIN,
    setupToken: SETUP_TOKEN,
    sessionSecure: false,
    now: () => NOW,
  });
  const authService = createAuthService(database, () => NOW);
  const careAuth = createCareAuth({ authService, appOrigin: APP_ORIGIN });

  app.post('/api/_test/care-context', async (request, reply) => {
    const context = await careAuth.requireWrite(request, reply);
    if (!context) return;
    return reply.send(context);
  });

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
  return { app, authService };
}

afterEach(async () => {
  if (database) {
    await database.close();
    database = undefined;
  }
});

describeDatabase('M2 authenticated care event foundation', () => {
  it('derives care ownership from Dad/Nanny sessions and invalidates a disabled Nanny session', async () => {
    const modules = await loadTask3Modules();
    if (!modules) return;
    const { app } = await createReadyApp(modules.createCareAuth);
    const dadCookie = await login(app, 'dad', 'dad-test-password');

    const dadContext = await app.inject({
      method: 'POST',
      url: '/api/_test/care-context',
      headers: { origin: APP_ORIGIN, cookie: dadCookie },
    });
    expect(dadContext.statusCode).toBe(200);
    expect(dadContext.json()).toMatchObject({ relationship: 'dad', permissionLevel: 'family_admin' });
    expect(dadContext.json().familyId).toMatch(/[0-9a-f-]{36}/);
    expect(dadContext.json().babyId).toMatch(/[0-9a-f-]{36}/);

    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/_test/care-context',
      headers: { origin: 'http://example.invalid', cookie: dadCookie },
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toMatchObject({ code: 'origin_not_allowed' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/family/members',
      headers: { origin: APP_ORIGIN, cookie: dadCookie },
      payload: { loginName: 'nanny', displayName: 'Nanny', password: 'nanny-test-password' },
    });
    expect(created.statusCode).toBe(201);
    const nannyMembershipId = created.json().membershipId as string;
    const nannyCookie = await login(app, 'nanny', 'nanny-test-password');

    const nannyContext = await app.inject({
      method: 'POST',
      url: '/api/_test/care-context',
      headers: { origin: APP_ORIGIN, cookie: nannyCookie },
    });
    expect(nannyContext.statusCode).toBe(200);
    expect(nannyContext.json()).toMatchObject({ relationship: 'nanny', permissionLevel: 'caregiver' });

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/api/family/members/${nannyMembershipId}/status`,
      headers: { origin: APP_ORIGIN, cookie: dadCookie },
      payload: { status: 'disabled' },
    });
    expect(disabled.statusCode).toBe(200);

    const oldNannySession = await app.inject({
      method: 'POST',
      url: '/api/_test/care-context',
      headers: { origin: APP_ORIGIN, cookie: nannyCookie },
    });
    expect(oldNannySession.statusCode).toBe(401);
    await app.close();
  });

  it('creates manual care events idempotently and preserves append-only revision/void history', async () => {
    const modules = await loadTask3Modules();
    if (!modules) return;
    const { app, authService } = await createReadyApp(modules.createCareAuth);
    const dadCookie = await login(app, 'dad', 'dad-test-password');
    const authenticated = await authService.authenticate(rawSessionToken(dadCookie));
    expect(authenticated).not.toBeNull();
    if (!authenticated) return;

    const actor: CareActorContext = {
      ...authenticated.context,
      babyId: authenticated.session.babyId,
    };
    const client = await database!.pool.connect();
    const clientRequestId = randomUUID();
    const traceId = randomUUID();

    try {
      await client.query('begin');
      const input = {
        actor,
        eventType: 'diaper',
        occurredAt: NOW,
        clientRequestId,
        note: 'private care note',
        traceId,
      };
      const first = await modules.repository.createCareEvent(client, input);
      const second = await modules.repository.createCareEvent(client, input);
      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        familyId: actor.familyId,
        babyId: actor.babyId,
        actorUserId: actor.userId,
        actorMembershipId: actor.membershipId,
        eventType: 'diaper',
        status: 'active',
        version: 1,
        clientRequestId,
      });

      expect((await modules.repository.findByClientRequestId(client, actor, clientRequestId))?.id).toBe(first.id);
      expect((await modules.repository.loadActiveCareEventForUpdate(client, actor, first.id))?.id).toBe(first.id);

      await modules.repository.appendCareRevision(client, {
        eventId: first.id,
        actor,
        action: 'void',
        fromVersion: 1,
        toVersion: 2,
        before: { status: 'active', version: 1 },
        after: { status: 'voided', version: 2 },
        traceId,
      });
      const voided = await modules.repository.voidCareEvent(client, {
        eventId: first.id,
        actor,
        updatedAt: NOW,
      });
      expect(voided).toMatchObject({ status: 'voided', version: 2 });
      expect(await modules.repository.loadActiveCareEventForUpdate(client, actor, first.id)).toBeNull();
      await client.query('commit');

      const count = await database!.pool.query<{ count: string }>(
        `select count(*)::text as count from care_events where client_request_id = $1`,
        [clientRequestId],
      );
      expect(count.rows[0]?.count).toBe('1');

      const revisions = await database!.pool.query<{ count: string }>(
        `select count(*)::text as count from care_event_revisions where event_id = $1`,
        [first.id],
      );
      expect(revisions.rows[0]?.count).toBe('1');

      const audits = await database!.pool.query<{ metadata_json: Record<string, unknown> | null }>(
        `select metadata_json from audit_events where action = 'care.event_created' and target_id = $1`,
        [first.id],
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.metadata_json).toEqual({ eventType: 'diaper', careSource: 'manual' });
      expect(JSON.stringify(audits.rows[0]?.metadata_json)).not.toContain('private care note');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
      await app.close();
    }
  });
});
