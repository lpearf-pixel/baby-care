import { describe, expect, test } from 'vitest';
import { buildServer } from '../src/server.ts';
describe('health routes', () => {
  test('GET /health/live is machine-readable and independent of database readiness', async () => { let databaseChecks = 0; const server = buildServer({ checkDatabase: async () => { databaseChecks += 1; throw new Error('offline'); } }); const response = await server.inject({ method: 'GET', url: '/health/live' }); expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ status: 'ok', service: 'baby-care-api' }); expect(databaseChecks).toBe(0); await server.close(); });
  test('GET /health/ready returns compact 503 for database failure', async () => { const server = buildServer({ checkDatabase: async () => { throw new Error('postgres://user:secret@db/babycare'); } }); const response = await server.inject({ method: 'GET', url: '/health/ready' }); expect(response.statusCode).toBe(503); expect(response.json()).toEqual({ status: 'error', service: 'baby-care-api', checks: { database: 'error' }, error_code: 'DATABASE_UNAVAILABLE' }); expect(response.body).not.toContain('secret'); await server.close(); });
});
