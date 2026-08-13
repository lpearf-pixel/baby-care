import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.ts';
const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://babycare:local@127.0.0.1:5432/babycare' };
test('loadConfig applies approved xiangxiang and Asia/Shanghai defaults', () => { const config = loadConfig(base); assert.equal(config.babyDisplayName, 'xiangxiang'); assert.equal(config.appTimezone, 'Asia/Shanghai'); assert.equal(config.apiHost, '0.0.0.0'); assert.equal(config.apiPort, 8787); });
test('loadConfig rejects invalid API_PORT with a compact CONFIG_INVALID code', () => { assert.throws(() => loadConfig({ ...base, API_PORT: '99999' }), (error) => error instanceof ConfigError && error.code === 'CONFIG_INVALID'); });
test('loadConfig rejects a missing or non-postgresql DATABASE_URL', () => { assert.throws(() => loadConfig({ NODE_ENV: 'test', DATABASE_URL: '' }), ConfigError); assert.throws(() => loadConfig({ ...base, DATABASE_URL: 'https://example.test/db' }), ConfigError); });
