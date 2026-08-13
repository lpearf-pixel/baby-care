import type { DatabaseContext } from '../db.js';
import { writeAudit } from '../audit/audit-repository.js';

export class SetupClosedError extends Error {
  readonly code = 'setup_closed' as const;

  constructor() {
    super('Setup is already complete.');
    this.name = 'SetupClosedError';
  }
}

export interface InitializeFamilyInput {
  familyName: string;
  babyDisplayName: string;
  dadLoginName: string;
  dadPasswordHash: string;
  momLoginName: string;
  momPasswordHash: string;
  traceId: string;
  occurredAt: Date;
}

export interface FamilyRepository {
  isInitialized(): Promise<boolean>;
  initialize(input: InitializeFamilyInput): Promise<void>;
}

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

export function createFamilyRepository(database: DatabaseContext): FamilyRepository {
  return {
    async isInitialized(): Promise<boolean> {
      const result = await database.pool.query<{ initialized: boolean }>(
        `select exists(select 1 from families where status = 'active') as initialized`,
      );
      return result.rows[0]?.initialized ?? false;
    },

    async initialize(input: InitializeFamilyInput): Promise<void> {
      const client = await database.pool.connect();
      try {
        await client.query('begin');

        const familyResult = await client.query<{ id: string }>(
          `insert into families (name, timezone, status)
           values ($1, 'Asia/Shanghai', 'active')
           returning id`,
          [input.familyName],
        );
        const familyId = familyResult.rows[0]!.id;

        await client.query(
          `insert into babies (family_id, display_name, status)
           values ($1, $2, 'active')`,
          [familyId, input.babyDisplayName],
        );

        const dadResult = await client.query<{ id: string }>(
          `insert into users (login_name, display_name, password_hash, status)
           values ($1, 'Dad', $2, 'active')
           returning id`,
          [normalizeLoginName(input.dadLoginName), input.dadPasswordHash],
        );
        const momResult = await client.query<{ id: string }>(
          `insert into users (login_name, display_name, password_hash, status)
           values ($1, 'Mom', $2, 'active')
           returning id`,
          [normalizeLoginName(input.momLoginName), input.momPasswordHash],
        );

        await client.query(
          `insert into family_memberships (family_id, user_id, relationship, permission_level, status)
           values
             ($1, $2, 'dad', 'family_admin', 'active'),
             ($1, $3, 'mom', 'family_admin', 'active')`,
          [familyId, dadResult.rows[0]!.id, momResult.rows[0]!.id],
        );

        await writeAudit(client, {
          familyId,
          action: 'family.setup_completed',
          targetType: 'family',
          targetId: familyId,
          source: 'api',
          traceId: input.traceId,
          occurredAt: input.occurredAt,
        });

        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        if ((error as { code?: string }).code === '23505') throw new SetupClosedError();
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
