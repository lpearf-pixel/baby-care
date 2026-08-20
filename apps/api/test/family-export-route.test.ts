import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext, AuthService } from '../src/auth/auth-service.js';
import type { FamilyExportService } from '../src/family/family-export-service.js';
import { registerFamilyExportRoute } from '../src/routes/family-export.js';
import {
  ExportInProgressError,
  StableExportCoordinator,
} from '../src/family/export-coordinator.js';

const origin = 'http://127.0.0.1:8080';
const context: AuthContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  membershipId: '22222222-2222-4222-8222-222222222222',
  familyId: '33333333-3333-4333-8333-333333333333',
  relationship: 'dad',
  permissionLevel: 'family_admin',
};

function fakeAuth(): AuthService {
  return {
    authenticate: vi.fn(async (token: string) => {
      if (token === 'valid' || token === 'mom') return { context: { ...context, relationship: token === 'mom' ? 'mom' : 'dad' }, session: {} as never };
      if (token === 'nanny') return { context: { ...context, relationship: 'nanny', permissionLevel: 'caregiver' }, session: {} as never };
      return null;
    }),
  } as unknown as AuthService;
}

function appWith(service: Partial<FamilyExportService> = {}) {
  const app = Fastify({ logger: false });
  const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
  const connect = vi.fn(async () => client);
  registerFamilyExportRoute(app, {
    authService: fakeAuth(),
    appOrigin: origin,
    exportService: {
      exportFamily: vi.fn(async () => ({
        document: {},
        serialized: Buffer.from('{"schemaVersion":1}'),
      })),
      ...service,
    } as FamilyExportService,
    coordinator: new StableExportCoordinator(),
    database: { pool: { connect } } as never,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });
  (app as unknown as { auditConnect: typeof connect }).auditConnect = connect;
  return app;
}

function noAttachment(response: { headers: Record<string, unknown>; body: string }): void {
  expect(response.headers['content-disposition']).toBeUndefined();
  expect(response.headers['cache-control']).toBeUndefined();
  expect(response.headers['x-content-type-options']).toBeUndefined();
  expect(response.body).not.toContain('schemaVersion');
}

describe('family export route', () => {
  it('requires an origin and authenticated family-admin session', async () => {
    const app = appWith();
    const wrongOrigin = await app.inject({ method: 'POST', url: '/api/family/export' });
    const missingCookie = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin } });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(missingCookie.statusCode).toBe(401);
    noAttachment(wrongOrigin);
    noAttachment(missingCookie);
    await app.close();
  });

  it('keeps exact stable shapes for wrong origin, invalid cookie, auth failure, and nanny', async () => {
    const app = appWith();
    const cases = [
      [{ origin: 'http://evil.test', cookie: 'baby_care_session=valid' }, 403, 'origin_not_allowed'],
      [{ origin, cookie: 'baby_care_session=invalid' }, 401, 'unauthenticated'],
      [{ origin, cookie: 'baby_care_session=nanny' }, 403, 'forbidden'],
    ] as const;
    for (const [headers, statusCode, code] of cases) {
      const response = await app.inject({ method: 'POST', url: '/api/family/export', headers });
      expect(response.statusCode).toBe(statusCode);
      expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
      expect(response.json().code).toBe(code);
      noAttachment(response);
    }
    expect((app as unknown as { auditConnect: ReturnType<typeof vi.fn> }).auditConnect).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps unexpected authentication errors to a closed export_failed response', async () => {
    const app = Fastify({ logger: false });
    registerFamilyExportRoute(app, {
      authService: { authenticate: vi.fn(async () => { throw new Error('database password'); }) } as unknown as AuthService,
      appOrigin: origin,
      exportService: {} as FamilyExportService,
      coordinator: new StableExportCoordinator(),
      database: {} as never,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    const response = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin, cookie: 'baby_care_session=valid' } });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'export_failed' });
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    expect(response.body).not.toContain('database password');
    noAttachment(response);
    await app.close();
  });

  it('denies the caregiver role without revealing export state', async () => {
    const app = appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=nanny' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'forbidden' });
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    noAttachment(response);
    expect((app as unknown as { auditConnect: ReturnType<typeof vi.fn> }).auditConnect).not.toHaveBeenCalled();
    await app.close();
  });

  it('ignores a forged body and derives family scope from the session', async () => {
    const exportFamily = vi.fn(async () => ({ document: {}, serialized: Buffer.from('{}') })) as unknown as FamilyExportService['exportFamily'];
    const app = appWith({ exportFamily });
    const response = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
      payload: { familyId: 'foreign', babyId: 'foreign' },
    });
    expect(response.statusCode).toBe(200);
    expect(exportFamily).toHaveBeenCalledWith(context, expect.any(Date));
    await app.close();
  });

  it('sets private attachment headers only after a successful export', async () => {
    const app = appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="baby-care-export-20260817T120000Z\.json"$/);
    const momResponse = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=mom' },
    });
    expect(momResponse.statusCode).toBe(200);
    expect(momResponse.headers['content-type']).toContain('application/json');
    expect(momResponse.headers['cache-control']).toBe('no-store');
    expect(momResponse.headers['x-content-type-options']).toBe('nosniff');
    expect(momResponse.headers['content-disposition']).toMatch(/^attachment; filename="baby-care-export-20260817T120000Z\.json"$/);
    await app.close();
  });

  it('does not emit attachment headers when preparation fails', async () => {
    const app = appWith({ exportFamily: vi.fn(async () => { throw new Error('database detail'); }) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'export_failed' });
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    expect(response.json().code).toBe('export_failed');
    noAttachment(response);
    expect((app as unknown as { auditConnect: ReturnType<typeof vi.fn> }).auditConnect).not.toHaveBeenCalled();
    expect(response.body).not.toContain('database detail');
    await app.close();
  });

  it.each([
    ['too large', async () => { const { FamilyExportTooLargeError } = await import('../src/family/family-export-service.js'); throw new FamilyExportTooLargeError(); }],
    ['non-buffer', async () => ({ document: {}, serialized: 'not-a-buffer' } as never)],
  ])('closes %s before response headers', async (_label, exportFamily) => {
    const app = appWith({ exportFamily: exportFamily as FamilyExportService['exportFamily'] });
    const response = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin, cookie: 'baby_care_session=valid' } });
    expect(response.statusCode).toBe(_label === 'too large' ? 413 : 500);
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    expect(response.json().code).toBe(_label === 'too large' ? 'export_too_large' : 'export_failed');
    noAttachment(response);
    expect((app as unknown as { auditConnect: ReturnType<typeof vi.fn> }).auditConnect).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 409 without a body when the actor slot is occupied', async () => {
    const coordinator = new StableExportCoordinator();
    let release!: () => void;
    const held = coordinator.run(context.userId, () => new Promise<void>((resolve) => { release = resolve; }));
    const app = Fastify({ logger: false });
    registerFamilyExportRoute(app, {
      authService: fakeAuth(), appOrigin: origin, exportService: {} as FamilyExportService,
      coordinator, database: {} as never, now: () => new Date('2026-08-17T12:00:00.000Z'),
    });
    const response = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin, cookie: 'baby_care_session=valid' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('export_in_progress');
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    noAttachment(response);
    release();
    await held;
    await app.close();
  });

  it('releases the actor slot after audit failure for immediate retry', async () => {
    const database = { pool: { connect: vi.fn(async () => ({ query: vi.fn(async () => { throw new Error('audit down'); }), release: vi.fn() })) } } as never;
    const app = Fastify({ logger: false });
    registerFamilyExportRoute(app, { authService: fakeAuth(), appOrigin: origin, exportService: {
      exportFamily: vi.fn(async () => ({ document: {}, serialized: Buffer.from('{}') })),
    } as unknown as FamilyExportService, coordinator: new StableExportCoordinator(), database, now: () => new Date('2026-08-17T12:00:00.000Z') });
    const first = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin, cookie: 'baby_care_session=valid' } });
    const second = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin, cookie: 'baby_care_session=valid' } });
    expect(first.statusCode).toBe(500);
    expect(second.statusCode).toBe(500);
    expect(first.json().code).toBe('export_failed');
    expect(second.json().code).toBe('export_failed');
    noAttachment(first); noAttachment(second);
    await app.close();
  });

  it.each(['begin', 'write', 'commit'] as const)('closes audit %s failure without a success response', async (failure) => {
    let calls = 0;
    const client = {
      query: vi.fn(async () => {
        calls += 1;
        if ((failure === 'begin' && calls === 1) || (failure === 'write' && calls === 2) || (failure === 'commit' && calls === 3)) throw new Error('audit internals');
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const app = Fastify({ logger: false });
    registerFamilyExportRoute(app, { authService: fakeAuth(), appOrigin: origin, exportService: {
      exportFamily: vi.fn(async () => ({ document: {}, serialized: Buffer.from('{"schemaVersion":1}') })),
    } as unknown as FamilyExportService, coordinator: new StableExportCoordinator(), database: { pool: { connect: vi.fn(async () => client) } } as never, now: () => new Date('2026-08-17T12:00:00.000Z') });
    const response = await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin, cookie: 'baby_care_session=valid' } });
    expect(response.statusCode).toBe(500);
    expect(Object.keys(response.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    noAttachment(response);
    expect(client.release).toHaveBeenCalledOnce();
    if (failure === 'begin') expect(calls).toBe(1);
    else if (failure === 'write') expect(calls).toBe(3);
    else expect(calls).toBe(4);
    await app.close();
  });
});

describe('stable export coordinator', () => {
  it('rejects a second operation for one actor and releases after every outcome', async () => {
    const coordinator = new StableExportCoordinator();
    let release!: () => void;
    const running = new Promise<void>((resolve) => { release = resolve; });
    const first = coordinator.run('actor', async () => running);
    await expect(coordinator.run('actor', async () => undefined)).rejects.toBeInstanceOf(ExportInProgressError);
    release();
    await first;
    await expect(coordinator.run('actor', async () => undefined)).resolves.toBeUndefined();
    await expect(coordinator.run('other', async () => undefined)).resolves.toBeUndefined();
    await expect(coordinator.run('actor', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(coordinator.run('actor', async () => undefined)).resolves.toBeUndefined();
  });

  it('admits different actors simultaneously and releases after rejection', async () => {
    const coordinator = new StableExportCoordinator();
    let release!: () => void;
    const first = coordinator.run('one', () => new Promise<void>((resolve) => { release = resolve; }));
    const second = coordinator.run('two', async () => 'second');
    await expect(second).resolves.toBe('second');
    release();
    await first;
    await expect(coordinator.run('one', async () => { throw new Error('abort'); })).rejects.toThrow('abort');
    await expect(coordinator.run('one', async () => 'retry')).resolves.toBe('retry');
  });
});
