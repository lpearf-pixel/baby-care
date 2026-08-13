import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.ts';
class FakeClient { applied = new Set<string>(); executedSql: string[] = []; async query(text: string, params: unknown[] = []) { if (text.includes("to_regclass('public.schema_migrations')")) return { rows: [{ table_name: this.applied.size > 0 ? 'schema_migrations' : null }] }; if (text.startsWith('SELECT filename FROM schema_migrations')) return { rows: [...this.applied].map((filename) => ({ filename })) }; if (text.startsWith('INSERT INTO schema_migrations')) { this.applied.add(String(params[0])); return { rows: [] }; } if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) this.executedSql.push(text); return { rows: [] }; } }
test('runMigrations applies each SQL file exactly once', async () => { const dir = await mkdtemp(join(tmpdir(), 'baby-care-migrations-')); await writeFile(join(dir, '0001_foundation.sql'), 'CREATE TABLE demo(id integer);'); const client = new FakeClient(); const first = await runMigrations(client, dir); const second = await runMigrations(client, dir); assert.deepEqual(first.applied, ['0001_foundation.sql']); assert.deepEqual(second.applied, []); assert.equal(client.executedSql.filter((sql) => sql.includes('CREATE TABLE demo')).length, 1); });
