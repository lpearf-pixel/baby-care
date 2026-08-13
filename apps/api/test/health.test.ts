import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthService } from '../src/health.ts';
test('liveness does not call the database', async () => { let calls = 0; const health = createHealthService({ checkDatabase: async () => { calls += 1; } }); const result = health.live(); assert.equal(result.statusCode, 200); assert.equal(result.body.status, 'ok'); assert.equal(calls, 0); });
test('readiness returns database ok when check succeeds', async () => { const health = createHealthService({ checkDatabase: async () => undefined }); const result = await health.ready(); assert.equal(result.statusCode, 200); assert.deepEqual(result.body.checks, { database: 'ok' }); });
test('readiness returns compact 503 without leaking database error details', async () => { const health = createHealthService({ checkDatabase: async () => { throw new Error('postgres://user:secret@db/babycare'); } }); const result = await health.ready(); assert.equal(result.statusCode, 503); assert.equal(result.body.status, 'error'); assert.equal(result.body.error_code, 'DATABASE_UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(result.body), /secret/); });
