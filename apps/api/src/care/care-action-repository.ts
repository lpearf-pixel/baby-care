import type pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { careActions } from '../schema.js';

export type CareActionInsert = typeof careActions.$inferInsert;

export async function insertCareActionRow(
  client: pg.PoolClient,
  input: CareActionInsert,
): Promise<void> {
  const orm = drizzle({ client });
  await orm.insert(careActions).values(input);
}
