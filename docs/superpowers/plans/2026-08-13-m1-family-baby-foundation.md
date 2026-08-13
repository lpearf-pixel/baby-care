# M1 Family and Baby Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one-family identity, the `xiangxiang` baby profile, Dad/Mom/Nanny authorization, server-side sessions, one-time setup, and attributable audit evidence without introducing care-recording behavior.

**Architecture:** Keep relationship/permission rules in framework-free `packages/domain`, API schemas in `packages/contracts`, and Fastify/PostgreSQL implementation in focused API modules. Use Drizzle schema + checked-in migrations, Argon2id passwords, SHA-256 hashed opaque sessions, strict same-origin unsafe requests, and a small React state shell.

**Tech Stack:** TypeScript, Node 24, Fastify, `@fastify/cookie`, PostgreSQL 16, Drizzle ORM/Kit, `argon2`, Zod, React/Vite, Vitest, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Read `/agent.md`, `docs/PLAN.md`, and `docs/superpowers/specs/2026-08-13-m1-family-baby-foundation-design.md` first.
- One active Family, one Baby, one active Dad, one active Mom, one active Nanny relationship.
- Dad/Mom = `family_admin`; Nanny = `caregiver`.
- Store only SHA-256 session-token hashes; cookie name is `baby_care_session`.
- Passwords use Argon2id.
- Password change revokes all old sessions and issues one new session.
- Nanny password reset revokes all Nanny sessions and does not auto-login Nanny.
- Unsafe browser requests require exact `Origin === BABY_CARE_APP_ORIGIN`.
- Login limiter: 10 attempts / 60 seconds / client address, memory-only; never persist the address.
- Baby `birth_date` is optional DATE only; never exact birth time.
- Do not add feeding, diaper, sleep, Guardian, AI, bottle-volume, or other M2 tables/defaults.
- CI failure diagnosis starts with compact artifacts, not full logs.

---

### Task 1: M1-A — Schema and migration runner

**Files:**
- Modify: `apps/api/src/schema.ts`
- Modify: `apps/api/src/db.ts`
- Modify: `apps/api/package.json`
- Create: `apps/api/test/migrations.integration.test.ts`
- Generate: `migrations/0000_m1_family_identity.sql`
- Generate: `migrations/meta/_journal.json`
- Generate: `migrations/meta/0000_snapshot.json`
- Modify: `infra/docker/api.Dockerfile`

**Produces:** `families`, `users`, `familyMemberships`, `babies`, `sessions`, `auditEvents`; `DatabaseContext.migrate(): Promise<void>`.

- [ ] **Step 1: Write RED PostgreSQL migration test**

```ts
const expectedTables = [
  'families',
  'users',
  'family_memberships',
  'babies',
  'sessions',
  'audit_events',
];

it('migrates an empty database and creates the six M1 tables', async () => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  await database.migrate();
  const result = await database.pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const names = new Set(result.rows.map((row) => row.table_name));
  for (const table of expectedTables) expect(names.has(table)).toBe(true);
  await database.close();
});
```

Add explicit SQL inserts asserting: second active Family fails; second Baby for the same family fails; second active `dad` membership fails; duplicate `sessions.token_hash` fails.

- [ ] **Step 2: Run RED test**

```bash
TEST_DATABASE_URL=postgres://babycare:babycare@127.0.0.1:5432/babycare_test pnpm --filter @baby-care/api test -- migrations.integration.test.ts
```

Expected: FAIL because M1 tables and `migrate()` do not exist.

- [ ] **Step 3: Define Drizzle schema and generate migration**

Use UUID PKs, timestamptz for session/audit times, DATE for `birth_date`, normalized stored `login_name`, and these SQL invariants:

```sql
CREATE UNIQUE INDEX families_single_active_idx ON families ((1)) WHERE status = 'active';
CREATE UNIQUE INDEX family_memberships_one_active_relationship_idx ON family_memberships (family_id, relationship) WHERE status = 'active';
CREATE UNIQUE INDEX babies_one_per_family_idx ON babies (family_id);
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions (token_hash);
```

Generate with:

```bash
DATABASE_URL=postgres://babycare:babycare@127.0.0.1:5432/babycare pnpm exec drizzle-kit generate --name m1_family_identity
```

If the numeric prefix is not `0000`, keep Drizzle's generated prefix and do not rename metadata independently.

- [ ] **Step 4: Add migration runner**

```ts
export interface DatabaseContext {
  pool: pg.Pool;
  orm: ReturnType<typeof drizzle>;
  migrate: () => Promise<void>;
  checkDatabase: () => Promise<boolean>;
  close: () => Promise<void>;
}
```

Use Drizzle's node-postgres migrator with `migrationsFolder: './migrations'`. Copy `migrations/` into the production API image.

- [ ] **Step 5: Run GREEN tests and commit**

```bash
pnpm --filter @baby-care/api test -- migrations.integration.test.ts
pnpm --filter @baby-care/api test
git add apps/api/src/schema.ts apps/api/src/db.ts apps/api/package.json apps/api/test/migrations.integration.test.ts migrations infra/docker/api.Dockerfile pnpm-lock.yaml
git commit -m "feat: add M1 family identity schema"
```

---

### Task 2: M1-B — Policy and security primitives

**Files:**
- Create: `packages/domain/src/identity.ts`
- Create: `packages/domain/src/policy.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/policy.test.ts`
- Create: `apps/api/src/auth/password.ts`
- Create: `apps/api/src/auth/session-token.ts`
- Create: `apps/api/src/auth/login-limiter.ts`
- Create: `apps/api/src/auth/origin-guard.ts`
- Create: `apps/api/test/security-primitives.test.ts`
- Modify: `apps/api/package.json`

**Interfaces:**

```ts
export type Relationship = 'dad' | 'mom' | 'nanny';
export type PermissionLevel = 'family_admin' | 'caregiver';
export type Capability = 'family.read' | 'family.update' | 'baby.read' | 'baby.update' | 'members.read' | 'members.manage' | 'credentials.reset_nanny';
export function can(permission: PermissionLevel, capability: Capability): boolean;
export async function hashPassword(password: string): Promise<string>;
export async function verifyPassword(hash: string, password: string): Promise<boolean>;
export function createSessionToken(): { raw: string; hash: string };
export function assertAllowedOrigin(origin: string | undefined, expectedOrigin: string): void;
```

- [ ] **Step 1: Write RED tests**

```ts
expect(can('caregiver', 'family.update')).toBe(false);
expect(can('family_admin', 'credentials.reset_nanny')).toBe(true);
const token = createSessionToken();
expect(token.raw).not.toBe(token.hash);
expect(() => assertAllowedOrigin(undefined, 'http://127.0.0.1:8080')).toThrow();
```

Limiter uses injected clock; attempts 1–10 pass, 11 fails, then succeeds after 60,001ms. Password tests prove correct/incorrect verification.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/domain test -- policy.test.ts
pnpm --filter @baby-care/api test -- security-primitives.test.ts
```

- [ ] **Step 3: Implement**

Use `argon2.hash(password, { type: argon2.argon2id })`; token raw bytes are `randomBytes(32).toString('base64url')`; hash is SHA-256 hex. Origin guard parses both URLs and compares `.origin` exactly.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @baby-care/domain test
pnpm --filter @baby-care/api test -- security-primitives.test.ts
pnpm typecheck
git add packages/domain apps/api/src/auth apps/api/test/security-primitives.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add M1 auth security primitives"
```

---

### Task 3: M1-C — Contracts, audit writer, and one-time setup

**Files:**
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/family.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/m1-contracts.test.ts`
- Create: `apps/api/src/audit/audit-repository.ts`
- Create: `apps/api/src/family/family-repository.ts`
- Create: `apps/api/src/family/setup-service.ts`
- Create: `apps/api/src/routes/setup.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `.env.example`
- Create: `apps/api/test/setup.integration.test.ts`

**Interfaces:**

```ts
export interface SetupInput {
  familyName: string;
  babyDisplayName: string;
  dad: { loginName: string; password: string };
  mom: { loginName: string; password: string };
}
```

- [ ] **Step 1: Write RED contracts/setup integration test**

Use concrete payload:

```ts
const setupPayload = {
  familyName: 'Xiangxiang Family',
  babyDisplayName: 'xiangxiang',
  dad: { loginName: 'dad', password: 'dad-test-password' },
  mom: { loginName: 'mom', password: 'mom-test-password' },
};
```

POST with `Origin: http://127.0.0.1:8080` and `x-baby-care-setup-token: local-test-setup-secret`. First request = 201; second = 409 `setup_closed`. Assert Family/Baby/Dad/Mom and `family.setup_completed` exist.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/contracts test -- m1-contracts.test.ts
pnpm --filter @baby-care/api test -- setup.integration.test.ts
```

- [ ] **Step 3: Implement config and transactional setup**

Add:

```ts
BABY_CARE_APP_ORIGIN: z.string().url(),
BABY_CARE_SETUP_TOKEN: z.string().min(16),
SESSION_SECURE: z.coerce.boolean().default(false),
```

Passwords validate 10–128 chars. If Family exists, return `setup_closed` before secret comparison. Setup secret uses timing-safe comparison. Family/Baby/users/memberships/audit insert in one DB transaction.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @baby-care/contracts test
pnpm --filter @baby-care/api test -- setup.integration.test.ts
git add packages/contracts apps/api/src/audit apps/api/src/family apps/api/src/routes/setup.ts apps/api/src/config.ts apps/api/src/app.ts apps/api/test/setup.integration.test.ts .env.example
git commit -m "feat: add one-time family setup"
```

---

### Task 4: M1-D — Session authentication lifecycle

**Files:**
- Create: `apps/api/src/auth/session-auth.ts`
- Create: `apps/api/src/auth/auth-service.ts`
- Create: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`
- Create: `apps/api/test/auth.integration.test.ts`

**Interfaces:**

```ts
export interface AuthContext {
  userId: string;
  membershipId: string;
  familyId: string;
  relationship: Relationship;
  permissionLevel: PermissionLevel;
}
```

- [ ] **Step 1: Write RED lifecycle tests**

After setup assert: wrong user and wrong password both return `401 invalid_credentials`; Dad login sets HttpOnly/Lax cookie; DB contains only token hash; current-session returns safe identity; logout invalidates cookie; password change invalidates old cookie and returns a different valid cookie; disabled membership invalidates an unexpired session.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- auth.integration.test.ts
```

- [ ] **Step 3: Implement with `@fastify/cookie`**

Session lookup hashes raw cookie then joins active session/user/membership. Login limiter runs before Argon2 verification. Password change transaction updates hash, revokes every existing session, inserts one replacement session, writes audit, then replaces cookie.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @baby-care/api test -- auth.integration.test.ts security-primitives.test.ts
pnpm --filter @baby-care/api test
git add apps/api/src/auth apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/package.json apps/api/test/auth.integration.test.ts pnpm-lock.yaml
git commit -m "feat: add server-side family sessions"
```

---

### Task 5: M1-E — Family/Baby/Nanny authorization APIs

**Files:**
- Create: `apps/api/src/family/family-service.ts`
- Create: `apps/api/src/routes/family.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/contracts/src/family.ts`
- Modify: `packages/contracts/test/m1-contracts.test.ts`
- Create: `apps/api/test/family-authorization.integration.test.ts`

- [ ] **Step 1: Write RED matrix test**

Prove:

```text
Dad GET family = 200
Nanny GET family = 200 safe projection
Dad PATCH family = 200
Nanny PATCH family = 403 forbidden
Dad PATCH baby = 200
Nanny PATCH baby = 403 forbidden
Dad POST Nanny = 201
Nanny POST member = 403 forbidden
Dad reset Nanny password = 204 and old Nanny session becomes 401
Dad attempts reset Mom password = 403 forbidden
```

Safe member DTO is exactly:

```ts
{ membershipId: string, displayName: string, relationship: Relationship, permissionLevel: PermissionLevel, status: 'active' | 'disabled' }
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- family-authorization.integration.test.ts
```

- [ ] **Step 3: Implement server-side policy guards**

Every mutation calls `can()` before DB writes. Only `nanny/caregiver` can be created. Second active Nanny returns `member_already_exists`. Disable/re-enable preserves history. Reset hashes new password and revokes all Nanny sessions in the same transaction as audit.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @baby-care/api test -- family-authorization.integration.test.ts
pnpm --filter @baby-care/domain test
pnpm --filter @baby-care/api test
git add apps/api/src/family apps/api/src/routes/family.ts apps/api/src/app.ts apps/api/test/family-authorization.integration.test.ts packages/contracts
git commit -m "feat: enforce family caregiver permissions"
```

---

### Task 6: M1-F — Audit completeness and secret-redaction regression

**Files:**
- Modify: `apps/api/src/audit/audit-repository.ts`
- Modify: `apps/api/src/family/setup-service.ts`
- Modify: `apps/api/src/auth/auth-service.ts`
- Modify: `apps/api/src/family/family-service.ts`
- Create: `apps/api/test/audit.integration.test.ts`

- [ ] **Step 1: Write RED audit test**

Exercise setup, failed/success login, logout, own password change, Nanny create/disable/enable/reset, family update, baby update. Assert required action names and:

```ts
const serialized = JSON.stringify(rows);
expect(serialized).not.toContain('dad-test-password');
expect(serialized).not.toContain('local-test-setup-secret');
expect(serialized).not.toContain('203.0.113.10');
expect(serialized).not.toContain('baby_care_session=');
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- audit.integration.test.ts
```

- [ ] **Step 3: Complete allowlisted audit writes**

Security/admin business mutation and required audit row share one DB transaction. Failed login audit uses singleton Family ID, null actor, and no login/password/address metadata.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @baby-care/api test -- audit.integration.test.ts
pnpm --filter @baby-care/api test
git add apps/api/src/audit apps/api/src/family/setup-service.ts apps/api/src/auth/auth-service.ts apps/api/src/family/family-service.ts apps/api/test/audit.integration.test.ts
git commit -m "feat: complete M1 identity audit trail"
```

---

### Task 7: M1-G — Web setup/login/family shell

**Files:**
- Create: `apps/web/src/api-client.ts`
- Create: `apps/web/src/auth/types.ts`
- Create: `apps/web/src/auth/SetupScreen.tsx`
- Create: `apps/web/src/auth/LoginScreen.tsx`
- Create: `apps/web/src/auth/AuthenticatedShell.tsx`
- Create: `apps/web/src/family/AdminFamilyPanel.tsx`
- Create: `apps/web/src/family/NannyFamilyView.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/test/App.test.tsx`

- [ ] **Step 1: Write RED UI tests**

Assert setup-required shows `xiangxiang`; setup token field is `type=password`; initialized unauthenticated shows login; Dad shows member-management controls; Nanny does not; invalid credentials use generic copy; page contains no fabricated last-feed/sleep state.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/web test
```

- [ ] **Step 3: Implement state shell**

Use exactly:

```ts
type AppState =
  | { kind: 'checking' }
  | { kind: 'setup-required' }
  | { kind: 'login' }
  | { kind: 'authenticated'; session: SessionDto }
  | { kind: 'degraded' };
```

All fetches use relative `/api/...` and `credentials: 'include'`. Do not add React Router.

- [ ] **Step 4: Run GREEN/build and commit**

```bash
pnpm --filter @baby-care/web test
pnpm --filter @baby-care/web typecheck
pnpm --filter @baby-care/web build
git add apps/web
git commit -m "feat: add M1 family identity workspace"
```

---

### Task 8: M1-H — Production startup and Compose M1 smoke

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `compose.yaml`
- Modify: `infra/docker/api.Dockerfile`
- Modify: `scripts/compose-smoke.mjs`
- Create: `apps/api/test/startup.integration.test.ts`

- [ ] **Step 1: Write RED startup test**

Assert server startup calls DB migration before listen; migration failure rejects startup and does not call listen.

- [ ] **Step 2: Extend Compose config**

Use only non-production defaults:

```text
BABY_CARE_APP_ORIGIN=http://127.0.0.1:8080
BABY_CARE_SETUP_TOKEN=local-development-setup-token-change-me
SESSION_SECURE=false
```

Production deployment overrides these values.

- [ ] **Step 3: Extend `compose-smoke.mjs`**

Maintain a small cookie jar from `set-cookie`. Execute exactly:

```text
GET setup/status -> required true
POST setup -> 201
POST Dad login -> cookie
GET auth/session -> dad/family_admin
POST create Nanny -> 201
POST Nanny login -> cookie
GET baby as Nanny -> 200
PATCH family as Nanny -> 403 forbidden
PATCH family as Dad -> 200
```

Every unsafe request includes `Origin: http://127.0.0.1:8080`.

- [ ] **Step 4: Run focused production verification**

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down -v --remove-orphans
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/test/startup.integration.test.ts compose.yaml infra/docker/api.Dockerfile scripts/compose-smoke.mjs
git commit -m "test: verify M1 production family flow"
```

---

### Task 9: M1-I — Review, final gate, and milestone handoff

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `.agent/current-milestone.json`
- Modify: `agent.md` only if a new cross-cutting rule truly emerged.

- [ ] **Step 1: Run final GitHub public-runner gate on final code head**

Require success for: `static`, `unit`, real-PostgreSQL `integration`, `build`, `compose-smoke`.

- [ ] **Step 2: Review final diff against spec**

Explicitly verify: no care/Guardian tables or UI defaults; no raw secrets in repo/log/audit fixtures; policy is enforced server-side; Nanny admin writes fail; session rotation/reset rules match spec; migrations work from empty DB; public API shapes have contract tests.

Fix Critical/Important findings before handoff.

- [ ] **Step 3: Persist M2 input gate**

Set `.agent/current-milestone.json` to:

```json
{
  "milestone": "M2 Care Recording MVP",
  "status": "waiting_for_real_care_habits",
  "m2_real_care_habits_gate": "user_input_required_before_design"
}
```

Preserve the completed-milestones list containing M0 and M1. Update `docs/PLAN.md` with final M1 CI run ID and the M2 input categories already recorded in `agent.md`.

- [ ] **Step 4: Re-run CI on final docs/state head**

The final branch head itself must have fresh 5-job success evidence.

- [ ] **Step 5: Create Draft PR**

If M0 is still unmerged, base M1 PR on `codex/m0-delivery-foundation`; if M0 has merged, base it on `main`. Include M1 scope, non-goals, final head SHA, final CI run ID, and the still-blocked M2 care-habits gate. Do not merge `main` without explicit user approval.
