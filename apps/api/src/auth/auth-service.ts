import type pg from 'pg';
import type { SessionDto } from '@baby-care/contracts';
import type { DatabaseContext } from '../db.js';
import { writeAudit } from '../audit/audit-repository.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSessionToken, hashSessionToken } from './session-token.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

type Relationship = SessionDto['relationship'];
type PermissionLevel = SessionDto['permissionLevel'];

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
  client: pg.Pool | pg.PoolClient,
  familyId: string,
  userId: string,
  now: Date,
): Promise<{ raw: string; hash: string }> {
  const token = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
  await client.query(
    `insert into sessions (family_id, user_id, token_hash, created_at, expires_at, last_seen_at)
     values ($1, $2, $3, $4, $5, $4)`,
    [familyId, userId, token.hash, now, expiresAt],
  );
  return token;
}

export function createAuthService(database: DatabaseContext, now: () => Date = () => new Date()) {
  async function activeFamilyId(): Promise<string | null> {
    const result = await database.pool.query<{ id: string }>(
      `select id from families where status = 'active' limit 1`,
    );
    return result.rows[0]?.id ?? null;
  }

  async function auditFailedLogin(traceId: string): Promise<void> {
    const familyId = await activeFamilyId();
    if (!familyId) return;
    const client = await database.pool.connect();
    try {
      await client.query('begin');
      await writeAudit(client, {
        familyId,
        actorUserId: null,
        actorMembershipId: null,
        action: 'auth.login_failed',
        targetType: 'auth',
        targetId: null,
        source: 'api',
        traceId,
        metadata: null,
        occurredAt: now(),
      });
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async function authenticate(rawToken: string): Promise<{ context: AuthContext; session: SessionDto } | null> {
    const current = now();
    const tokenHash = hashSessionToken(rawToken);
    const result = await database.pool.query<AuthRow>(
      authSelect(`
        join sessions s on s.user_id = u.id and s.family_id = fm.family_id
        where s.token_hash = $1
          and s.revoked_at is null
          and s.expires_at > $2
      `),
      [tokenHash, current],
    );
    const row = result.rows[0];
    if (!row) return null;

    await database.pool.query(
      `update sessions set last_seen_at = $2 where token_hash = $1 and revoked_at is null`,
      [tokenHash, current],
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
  }

  return {
    async login(loginName: string, password: string, traceId: string): Promise<LoginResult | null> {
      const result = await database.pool.query<AuthRow>(
        authSelect('where u.login_name = $1'),
        [normalizeLoginName(loginName)],
      );
      const row = result.rows[0];
      if (!row?.password_hash || !(await verifyPassword(row.password_hash, password))) {
        await auditFailedLogin(traceId);
        return null;
      }

      const current = now();
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        const token = await insertSession(client, row.family_id, row.user_id, current);
        await writeAudit(client, {
          familyId: row.family_id,
          actorUserId: row.user_id,
          actorMembershipId: row.membership_id,
          action: 'auth.login_succeeded',
          targetType: 'user',
          targetId: row.user_id,
          source: 'api',
          traceId,
          metadata: null,
          occurredAt: current,
        });
        await client.query('commit');
        return { rawToken: token.raw, session: toSessionDto(row) };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    authenticate,

    async logout(rawToken: string, traceId: string): Promise<void> {
      const authenticated = await authenticate(rawToken);
      if (!authenticated) return;
      const current = now();
      const client = await database.pool.connect();
      try {
        await client.query('begin');
        await client.query(
          `update sessions set revoked_at = coalesce(revoked_at, $2) where token_hash = $1`,
          [hashSessionToken(rawToken), current],
        );
        await writeAudit(client, {
          familyId: authenticated.context.familyId,
          actorUserId: authenticated.context.userId,
          actorMembershipId: authenticated.context.membershipId,
          action: 'auth.logout',
          targetType: 'user',
          targetId: authenticated.context.userId,
          source: 'api',
          traceId,
          metadata: null,
          occurredAt: current,
        });
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async changePassword(
      rawToken: string,
      currentPassword: string,
      nextPassword: string,
      traceId: string,
    ): Promise<LoginResult | null> {
      const authenticated = await authenticate(rawToken);
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
        await writeAudit(client, {
          familyId: authenticated.context.familyId,
          actorUserId: authenticated.context.userId,
          actorMembershipId: authenticated.context.membershipId,
          action: 'auth.password_changed',
          targetType: 'user',
          targetId: authenticated.context.userId,
          source: 'api',
          traceId,
          metadata: null,
          occurredAt: current,
        });
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
