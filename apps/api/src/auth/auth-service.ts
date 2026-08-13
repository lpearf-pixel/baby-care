import type { SessionDto } from '@baby-care/contracts';
import type { Relationship, PermissionLevel } from '@baby-care/domain';
import type { DatabaseContext } from '../db.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSessionToken, hashSessionToken } from './session-token.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthContext {
  userId: string;
  membershipId: string;
  familyId: string;
  relationship: Relationship;
  permissionLevel: PermissionLevel;
}

export interface LoginResult {
  rawToken: string;
  session: SessionDto;
}

interface AuthRow {
  user_id: string;
  membership_id: string;
  family_id: string;
  display_name: string;
  relationship: Relationship;
  permission_level: PermissionLevel;
  family_name: string;
  baby_id: string;
  baby_display_name: string;
  password_hash?: string;
}

function normalizeLoginName(value: string): string {
  return value.trim().toLowerCase();
}

function toSessionDto(row: AuthRow): SessionDto {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    relationship: row.relationship,
    permissionLevel: row.permission_level,
    familyId: row.family_id,
    familyName: row.family_name,
    babyId: row.baby_id,
    babyDisplayName: row.baby_display_name,
  };
}

function authSelect(whereClause: string): string {
  return `
    select
      u.id as user_id,
      fm.id as membership_id,
      f.id as family_id,
      u.display_name,
      u.password_hash,
      fm.relationship,
      fm.permission_level,
      f.name as family_name,
      b.id as baby_id,
      b.display_name as baby_display_name
    from users u
    join family_memberships fm on fm.user_id = u.id and fm.status = 'active'
    join families f on f.id = fm.family_id and f.status = 'active'
    join babies b on b.family_id = f.id and b.status = 'active'
    ${whereClause}
      and u.status = 'active'
    limit 1`;
}

async function insertSession(
  database: DatabaseContext,
  familyId: string,
  userId: string,
  now: Date,
): Promise<{ raw: string; hash: string }> {
  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await database.pool.query(
    `insert into sessions (family_id, user_id, token_hash, created_at, expires_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $4)`,
    [familyId, userId, token.hash, now, expiresAt],
  );
  return token;
}

export function createAuthService(database: DatabaseContext, now: () => Date = () => new Date()) {
  return {
    async login(loginName: string, password: string): Promise<LoginResult | null> {
      const result = await database.pool.query<AuthRow>(
        authSelect('where u.login_name = $1'),
        [normalizeLoginName(loginName)],
      );
      const row = result.rows[0];
      if (!row?.password_hash) return null;
      if (!(await verifyPassword(row.password_hash, password))) return null;

      const token = await insertSession(database, row.family_id, row.user_id, now());
      return { rawToken: token.raw, session: toSessionDto(row) };
    },

    async authenticate(rawToken: string): Promise<{ context: AuthContext; session: SessionDto } | null> {
      const current = now();
      const result = await database.pool.query<AuthRow>(
        `${authSelect(`
          join sessions s on s.user_id = u.id and s.family_id = fm.family_id
          where s.token_hash = $1
            and s.revoked_at is null
            and s.expires_at > $2
        `)}`,
        [hashSessionToken(rawToken), current],
      );
      const row = result.rows[0];
      if (!row) return null;

      await database.pool.query(
        `update sessions set last_seen_at = $2 where token_hash = $1 and revoked_at is null`,
        [hashSessionToken(rawToken), current],
      );

      return {
        context: {
          userId: row.user_id,
          membershipId: row.membership_id,
          familyId: row.family_id,
          relationship: row.relationship,
          permissionLevel: row.permission_level,
        },
        session: toSessionDto(row),
      };
    },

    async logout(rawToken: string): Promise<void> {
      await database.pool.query(
        `update sessions set revoked_at = coalesce(revoked_at, $2) where token_hash = $1`,
        [hashSessionToken(rawToken), now()],
      );
    },

    async changePassword(
      rawToken: string,
      currentPassword: string,
      nextPassword: string,
    ): Promise<LoginResult | null> {
      const authenticated = await this.authenticate(rawToken);
      if (!authenticated) return null;

      const passwordResult = await database.pool.query<{ password_hash: string }>(
        `select password_hash from users where id = $1 and status = 'active'`,
        [authenticated.context.userId],
      );
      const passwordHash = passwordResult.rows[0]?.password_hash;
      if (!passwordHash || !(await verifyPassword(passwordHash, currentPassword))) return null;

      const nextHash = await hashPassword(nextPassword);
      const current = now();
      const token = createSessionToken();
      const expiresAt = new Date(current.getTime() + SESSION_LIFETIME_MS);
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        await client.query(`update users set password_hash = $2, updated_at = $3 where id = $1`, [
          authenticated.context.userId,
          nextHash,
          current,
        ]);
        await client.query(
          `update sessions set revoked_at = coalesce(revoked_at, $2) where user_id = $1`,
          [authenticated.context.userId, current],
        );
        await client.query(
          `insert into sessions (family_id, user_id, token_hash, created_at, expires_at, last_seen_at)
           values ($1, $2, $3, $4, $5, $4)`,
          [
            authenticated.context.familyId,
            authenticated.context.userId,
            token.hash,
            current,
            expiresAt,
          ],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }

      return { rawToken: token.raw, session: authenticated.session };
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
