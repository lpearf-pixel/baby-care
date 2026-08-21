import { describe, expect, test, vi } from 'vitest';

import type { DatabaseContext } from '../src/db.js';
import {
  RestoredDatabaseVerifierError,
  verifyRestoredDatabase,
} from '../src/operations/verify-restored-database.js';

const actorRow = {
  family_id: '11111111-1111-4111-8111-111111111111',
  baby_id: '22222222-2222-4222-8222-222222222222',
  user_id: '33333333-3333-4333-8333-333333333333',
  membership_id: '44444444-4444-4444-8444-444444444444',
  relationship: 'dad',
  permission_level: 'family_admin',
  as_of: new Date('2026-08-17T12:34:56.000Z'),
};

function fakeDatabase(failPattern?: RegExp): { database: DatabaseContext; queries: string[] } {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (failPattern?.test(sql)) throw new Error('postgres://secret@private/household row-value');
      if (/restore-verifier-actor-v1/.test(sql)) return { rows: [actorRow] };
      if (/coalesce\(sum\(fc\.amount_ml\)/.test(sql)) {
        return {
          rows: [{
            bottle_total_ml: 0,
            expressed_breast_milk_ml: 0,
            formula_ml: 0,
            direct_breastfeeding_sessions: 0,
            direct_breastfeeding_minutes: 0,
          }],
        };
      }
      return { rows: [] };
    },
    release: vi.fn(),
  };
  const database = {
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => client.query(sql)),
    },
  } as unknown as DatabaseContext;
  return { database, queries };
}

describe('verifyRestoredDatabase', () => {
  test('derives one server-owned actor and executes summary plus a one-item timeline in one read snapshot', async () => {
    const { database, queries } = fakeDatabase();

    await expect(verifyRestoredDatabase(database)).resolves.toEqual({
      summaryExecutable: true,
      timelineExecutable: true,
    });

    expect(queries[0]).toBe('begin isolation level repeatable read read only');
    expect(queries.some((sql) => sql.includes('restore-verifier-actor-v1'))).toBe(true);
    expect(queries.find((sql) => sql.includes('restore-verifier-actor-v1'))).toContain('limit 1');
    expect(queries.some((sql) => /limit \$\d+/.test(sql))).toBe(true);
    expect(queries.at(-1)).toBe('commit');
  });

  test.each([
    ['actor derivation', /restore-verifier-actor-v1/],
    ['summary query', /coalesce\(sum\(fc\.amount_ml\)/],
    ['timeline query', /from care_events ce/],
  ])('fails closed without exposing details for %s failure', async (_label, failPattern) => {
    const { database } = fakeDatabase(failPattern);
    let caught: unknown;
    try {
      await verifyRestoredDatabase(database);
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(new RestoredDatabaseVerifierError());
    expect(String(caught)).not.toMatch(/secret|private|household|row-value/);
  });

  test('fails closed when the fixed actor query does not return exactly one row', async () => {
    const { database } = fakeDatabase();
    (database.pool.connect as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      query: vi.fn(async (sql: string) =>
        /restore-verifier-actor-v1/.test(sql) ? { rows: [] } : { rows: [] },
      ),
      release: vi.fn(),
    });
    await expect(verifyRestoredDatabase(database)).rejects.toEqual(
      new RestoredDatabaseVerifierError(),
    );
  });
});
