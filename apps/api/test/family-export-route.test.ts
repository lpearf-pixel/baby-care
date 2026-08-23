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
    expect((app as unknown as { auditConnect: ReturnType<typeof vi.fn> }).auditConnect).not.toHaveBeenCalled();
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
    expect(exportFamily).toHaveBeenCalledWith(
      context,
      expect.any(Date),
      expect.any(AbortSignal),
    );
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
    expect(Object.keys(first.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    expect(Object.keys(second.json()).sort()).toEqual(['code', 'message', 'traceId'].sort());
    expect(first.json().code).toBe('export_failed');
    expect(second.json().code).toBe('export_failed');
    noAttachment(first); noAttachment(second);
    await app.close();
  });

  it.each(['begin', 'write', 'commit'] as const)('closes audit %s failure without a success response', async (failure) => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (statement: string) => {
        const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
        statements.push(normalized);
        if (
          (failure === 'begin' && normalized === 'begin')
          || (failure === 'write' && normalized.startsWith('insert into audit_events'))
          || (failure === 'commit' && normalized === 'commit')
        ) throw new Error('audit internals');
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
    expect(response.json().code).toBe('export_failed');
    noAttachment(response);
    expect(client.release).toHaveBeenCalledOnce();
    if (failure === 'begin') expect(statements).toEqual(['begin']);
    else if (failure === 'write') expect(statements).toEqual([
      'begin',
      'set local statement_timeout = 30000',
      'insert into audit_events ( family_id, actor_user_id, actor_membership_id, action, target_type, target_id, source, trace_id, metadata_json, occurred_at ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      'rollback',
    ]);
    else expect(statements).toEqual([
      'begin',
      'set local statement_timeout = 30000',
      'insert into audit_events ( family_id, actor_user_id, actor_membership_id, action, target_type, target_id, source, trace_id, metadata_json, occurred_at ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      'commit',
      'rollback',
    ]);
    await app.close();
  });
});

  it('waits for audit statement timeout settlement before release and retry', async () => {
    vi.useFakeTimers();
    try {
      const app = Fastify({ logger: false });
      const statements: string[] = [];
      let auditWriteAttempt = 0;
      const client = {
        query: vi.fn(async (statement: string) => {
          const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
          statements.push(normalized);
          if (normalized.startsWith('insert into audit_events')) {
            auditWriteAttempt += 1;
            if (auditWriteAttempt === 1) {
              return new Promise((_resolve, reject) => {
                setTimeout(() => {
                  reject(Object.assign(new Error('statement timeout'), { code: '57014' }));
                }, 30_001);
              });
            }
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };
      registerFamilyExportRoute(app, {
        authService: fakeAuth(),
        appOrigin: origin,
        exportService: {
          exportFamily: vi.fn(async () => ({ document: {}, serialized: Buffer.from('{}') })),
        } as unknown as FamilyExportService,
        coordinator: new StableExportCoordinator(),
        database: { pool: { connect: vi.fn(async () => client) } } as never,
        now: () => new Date('2026-08-17T12:00:00.000Z'),
      });

      let requestSettled = false;
      const timedOut = app.inject({
        method: 'POST',
        url: '/api/family/export',
        headers: { origin, cookie: 'baby_care_session=valid' },
      }).then((response) => {
        requestSettled = true;
        return response;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(requestSettled).toBe(false);
      expect(client.release).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect((await timedOut).body).toBe('');
      expect(statements.slice(-1)).toEqual(['rollback']);
      expect(statements).not.toContain('commit');
      expect(client.release).toHaveBeenCalledWith();
      expect(client.release).not.toHaveBeenCalledWith(true);

      const retry = await app.inject({
        method: 'POST',
        url: '/api/family/export',
        headers: { origin, cookie: 'baby_care_session=valid' },
      });
      expect(retry.statusCode).toBe(200);
      await app.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys an aborted audit client and waits for its query settlement before retry', async () => {
    const app = Fastify({ logger: false });
    let requestRaw: { emit(event: string): boolean } | undefined;
    let markAuditStarted!: () => void;
    let rejectAudit!: (error: Error) => void;
    const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve; });
    const firstStatements: string[] = [];
    const firstClient = {
      query: vi.fn(async (statement: string) => {
        const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
        firstStatements.push(normalized);
        if (normalized.startsWith('insert into audit_events')) {
          markAuditStarted();
          return new Promise((_resolve, reject) => { rejectAudit = reject; });
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const connect = vi.fn()
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);
    app.addHook('onRequest', (request, _reply, done) => {
      requestRaw = request.raw;
      done();
    });
    registerFamilyExportRoute(app, {
      authService: fakeAuth(),
      appOrigin: origin,
      exportService: {
        exportFamily: vi.fn(async () => ({ document: {}, serialized: Buffer.from('{}') })),
      } as unknown as FamilyExportService,
      coordinator: new StableExportCoordinator(),
      database: { pool: { connect } } as never,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });

    let requestSettled = false;
    const disconnected = app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    }).then((response) => {
      requestSettled = true;
      return response;
    });
    await auditStarted;
    requestRaw?.emit('aborted');

    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(requestSettled).toBe(false);
    const whileSettling = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(whileSettling.statusCode).toBe(409);

    rejectAudit(new Error('synthetic connection destruction'));
    expect((await disconnected).body).toBe('');
    expect(firstStatements).not.toContain('commit');
    const retry = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(retry.statusCode).toBe(200);
    expect(secondClient.release).toHaveBeenCalledWith();
    await app.close();
  });

  it('destroys a late audit client acquired after abort before releasing the actor slot', async () => {
    const app = Fastify({ logger: false });
    let requestRaw: { emit(event: string): boolean } | undefined;
    let markConnectStarted!: () => void;
    let resolveFirstConnect!: (client: {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    }) => void;
    const connectStarted = new Promise<void>((resolve) => { markConnectStarted = resolve; });
    const firstClient = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const secondClient = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const connect = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstConnect = resolve;
        markConnectStarted();
      }))
      .mockResolvedValueOnce(secondClient);
    app.addHook('onRequest', (request, _reply, done) => {
      requestRaw = request.raw;
      done();
    });
    registerFamilyExportRoute(app, {
      authService: fakeAuth(),
      appOrigin: origin,
      exportService: {
        exportFamily: vi.fn(async () => ({ document: {}, serialized: Buffer.from('{}') })),
      } as unknown as FamilyExportService,
      coordinator: new StableExportCoordinator(),
      database: { pool: { connect } } as never,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });

    let requestSettled = false;
    const disconnected = app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    }).then((response) => {
      requestSettled = true;
      return response;
    });
    await connectStarted;
    requestRaw?.emit('aborted');

    expect(requestSettled).toBe(false);
    const whileSettling = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(whileSettling.statusCode).toBe(409);
    resolveFirstConnect(firstClient);

    expect((await disconnected).body).toBe('');
    expect(firstClient.query).not.toHaveBeenCalled();
    expect(firstClient.release).toHaveBeenCalledWith(true);
    const retry = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(retry.statusCode).toBe(200);
    await app.close();
  });

  it('settles disconnect cancellation before releasing the actor slot for retry', async () => {
    const app = Fastify({ logger: false });
    let requestRaw: { emit(event: string): boolean } | undefined;
    let attempt = 0;
    const events: string[] = [];
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const connect = vi.fn(async () => client);
    app.addHook('onRequest', (request, _reply, done) => {
      requestRaw = request.raw;
      done();
    });
    registerFamilyExportRoute(app, {
      authService: fakeAuth(),
      appOrigin: origin,
      exportService: {
        exportFamily: vi.fn(async (_actor, _generatedAt, signal: AbortSignal) => {
          attempt += 1;
          if (attempt > 1) {
            events.push('retry');
            return { document: {}, serialized: Buffer.from('{}') };
          }
          expect(signal).toBeInstanceOf(AbortSignal);
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
              events.push('cancel');
              queueMicrotask(() => {
                events.push('settled');
                reject(Object.assign(new Error('cancelled'), { code: 'export_cancelled' }));
              });
            }, { once: true });
            requestRaw?.emit('aborted');
            void resolve;
          });
        }),
      } as unknown as FamilyExportService,
      coordinator: new StableExportCoordinator(),
      database: { pool: { connect } } as never,
      now: () => new Date('2026-08-17T12:00:00.000Z'),
    });

    const disconnected = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(disconnected.body).toBe('');
    expect(connect).not.toHaveBeenCalled();

    const retry = await app.inject({
      method: 'POST',
      url: '/api/family/export',
      headers: { origin, cookie: 'baby_care_session=valid' },
    });
    expect(retry.statusCode).toBe(200);
    expect(events).toEqual(['cancel', 'settled', 'retry']);
    expect(connect).toHaveBeenCalledOnce();
    await app.close();
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
