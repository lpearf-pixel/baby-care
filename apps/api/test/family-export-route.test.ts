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
    database: { pool: { connect: vi.fn(async () => client) } } as never,
    now: () => new Date('2026-08-17T12:00:00.000Z'),
  });
  return app;
}

describe('family export route', () => {
  it('requires an origin and authenticated family-admin session', async () => {
    const app = appWith();
    await expect((await app.inject({ method: 'POST', url: '/api/family/export' })).statusCode).toBe(403);
    await expect((await app.inject({ method: 'POST', url: '/api/family/export', headers: { origin } })).statusCode).toBe(401);
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
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.body).not.toContain('database detail');
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
});
