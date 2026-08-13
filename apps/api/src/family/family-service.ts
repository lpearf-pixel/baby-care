import type {
  BabyDto,
  CreateNannyInput,
  FamilyDto,
  MemberDto,
  UpdateBabyInput,
  UpdateFamilyInput,
} from '@baby-care/contracts';
import { can, type Capability } from '@baby-care/domain';
import type { DatabaseContext } from '../db.js';
import type { AuthContext } from '../auth/auth-service.js';
import { hashPassword } from '../auth/password.js';

export class FamilyForbiddenError extends Error {
  readonly code = 'forbidden' as const;
  constructor() {
    super('This account does not have permission for that action.');
    this.name = 'FamilyForbiddenError';
  }
}

export class MemberAlreadyExistsError extends Error {
  readonly code = 'member_already_exists' as const;
  constructor() {
    super('An active Nanny already exists.');
    this.name = 'MemberAlreadyExistsError';
  }
}

export class LoginNameConflictError extends Error {
  readonly code = 'login_name_conflict' as const;
  constructor() {
    super('That login name is already in use.');
    this.name = 'LoginNameConflictError';
  }
}

function requireCapability(context: AuthContext, capability: Capability): void {
  if (!can(context.permissionLevel, capability)) throw new FamilyForbiddenError();
}

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

export function createFamilyService(database: DatabaseContext) {
  async function listMembers(context: AuthContext): Promise<MemberDto[]> {
    requireCapability(context, 'members.read');
    const result = await database.pool.query<{
      membership_id: string;
      display_name: string;
      relationship: MemberDto['relationship'];
      permission_level: MemberDto['permissionLevel'];
      status: MemberDto['status'];
    }>(
      `select fm.id as membership_id, u.display_name, fm.relationship, fm.permission_level, fm.status
       from family_memberships fm
       join users u on u.id = fm.user_id
       where fm.family_id = $1
       order by case fm.relationship when 'dad' then 1 when 'mom' then 2 else 3 end, u.display_name`,
      [context.familyId],
    );
    return result.rows.map((row) => ({
      membershipId: row.membership_id,
      displayName: row.display_name,
      relationship: row.relationship,
      permissionLevel: row.permission_level,
      status: row.status,
    }));
  }

  async function nannyTarget(context: AuthContext, membershipId: string) {
    const result = await database.pool.query<{ user_id: string; relationship: string }>(
      `select user_id, relationship from family_memberships where id = $1 and family_id = $2 limit 1`,
      [membershipId, context.familyId],
    );
    const row = result.rows[0];
    if (!row || row.relationship !== 'nanny') throw new FamilyForbiddenError();
    return row;
  }

  return {
    async getFamily(context: AuthContext): Promise<FamilyDto> {
      requireCapability(context, 'family.read');
      const result = await database.pool.query<FamilyDto>(
        `select id, name, timezone, status from families where id = $1 and status = 'active' limit 1`,
        [context.familyId],
      );
      if (!result.rows[0]) throw new Error('active family missing');
      return result.rows[0];
    },

    async updateFamily(context: AuthContext, input: UpdateFamilyInput): Promise<FamilyDto> {
      requireCapability(context, 'family.update');
      const result = await database.pool.query<FamilyDto>(
        `update families
         set name = coalesce($2, name), timezone = coalesce($3, timezone), updated_at = now()
         where id = $1 and status = 'active'
         returning id, name, timezone, status`,
        [context.familyId, input.name ?? null, input.timezone ?? null],
      );
      if (!result.rows[0]) throw new Error('active family missing');
      return result.rows[0];
    },

    async getBaby(context: AuthContext): Promise<BabyDto> {
      requireCapability(context, 'baby.read');
      const result = await database.pool.query<{
        id: string;
        display_name: string;
        birth_date: string | null;
        status: 'active';
      }>(
        `select id, display_name, birth_date, status from babies where family_id = $1 and status = 'active' limit 1`,
        [context.familyId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('active baby missing');
      return { id: row.id, displayName: row.display_name, birthDate: row.birth_date, status: row.status };
    },

    async updateBaby(context: AuthContext, input: UpdateBabyInput): Promise<BabyDto> {
      requireCapability(context, 'baby.update');
      const hasBirthDate = Object.prototype.hasOwnProperty.call(input, 'birthDate');
      const result = await database.pool.query<{
        id: string;
        display_name: string;
        birth_date: string | null;
        status: 'active';
      }>(
        `update babies
         set display_name = coalesce($2, display_name),
             birth_date = case when $3::boolean then $4::date else birth_date end,
             updated_at = now()
         where family_id = $1 and status = 'active'
         returning id, display_name, birth_date, status`,
        [context.familyId, input.displayName ?? null, hasBirthDate, input.birthDate ?? null],
      );
      const row = result.rows[0];
      if (!row) throw new Error('active baby missing');
      return { id: row.id, displayName: row.display_name, birthDate: row.birth_date, status: row.status };
    },

    listMembers,

    async createNanny(context: AuthContext, input: CreateNannyInput): Promise<MemberDto> {
      requireCapability(context, 'members.manage');
      const active = await database.pool.query(
        `select 1 from family_memberships where family_id = $1 and relationship = 'nanny' and status = 'active' limit 1`,
        [context.familyId],
      );
      if (active.rowCount) throw new MemberAlreadyExistsError();

      const passwordHash = await hashPassword(input.password);
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const user = await client.query<{ id: string }>(
          `insert into users (login_name, display_name, password_hash, status)
           values ($1, $2, $3, 'active') returning id`,
          [normalizeLoginName(input.loginName), input.displayName, passwordHash],
        );
        const membership = await client.query<{ id: string }>(
          `insert into family_memberships (family_id, user_id, relationship, permission_level, status)
           values ($1, $2, 'nanny', 'caregiver', 'active') returning id`,
          [context.familyId, user.rows[0]!.id],
        );
        await client.query('commit');
        return {
          membershipId: membership.rows[0]!.id,
          displayName: input.displayName,
          relationship: 'nanny',
          permissionLevel: 'caregiver',
          status: 'active',
        };
      } catch (error) {
        await client.query('rollback');
        if ((error as { code?: string }).code === '23505') throw new LoginNameConflictError();
        throw error;
      } finally {
        client.release();
      }
    },

    async setNannyStatus(context: AuthContext, membershipId: string, status: 'active' | 'disabled'): Promise<MemberDto> {
      requireCapability(context, 'members.manage');
      await nannyTarget(context, membershipId);
      try {
        await database.pool.query(
          `update family_memberships set status = $3, updated_at = now() where id = $1 and family_id = $2`,
          [membershipId, context.familyId, status],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new MemberAlreadyExistsError();
        throw error;
      }
      const members = await listMembers(context);
      const member = members.find((item) => item.membershipId === membershipId);
      if (!member) throw new Error('Nanny membership missing after update');
      return member;
    },

    async resetNannyPassword(context: AuthContext, membershipId: string, newPassword: string): Promise<void> {
      requireCapability(context, 'credentials.reset_nanny');
      const target = await nannyTarget(context, membershipId);
      const passwordHash = await hashPassword(newPassword);
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        await client.query(`update users set password_hash = $2, updated_at = now() where id = $1`, [target.user_id, passwordHash]);
        await client.query(`update sessions set revoked_at = coalesce(revoked_at, now()) where user_id = $1`, [target.user_id]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

export type FamilyService = ReturnType<typeof createFamilyService>;
