# M1 Family and Baby Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one-family identity, `xiangxiang` baby profile, Dad/Mom/Nanny authorization, server-side sessions, one-time setup, and attributable audit evidence without introducing care-recording behavior.

**Architecture:** Keep shared identity/policy types framework-free in `packages/domain`, API request/response schemas in `packages/contracts`, and Fastify/PostgreSQL implementation in focused `apps/api` modules. Use Drizzle schema + checked-in migrations, Argon2id passwords, hashed opaque server sessions, strict same-origin unsafe requests, and a small React state shell rather than adding a routing framework.

**Tech Stack:** TypeScript, Node 24, Fastify, `@fastify/cookie`, PostgreSQL 16, Drizzle ORM/Kit, Argon2id (`argon2` package), Zod, React/Vite, Vitest, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Read `/agent.md`, `docs/PLAN.md`, and `docs/superpowers/specs/2026-08-13-m1-family-baby-foundation-design.md` before execution.
- M1 supports one active Family, one `xiangxiang` Baby, one active Dad, one active Mom, and one active Nanny relationship.
- Dad/Mom map to `family_admin`; Nanny maps to `caregiver`.
- Use server-side opaque sessions; store only SHA-256 session-token hashes.
- Passwords use Argon2id; never log raw passwords or tokens.
- Password change revokes all old sessions and issues one new current session.
- Nanny password reset revokes all Nanny sessions and does not auto-login Nanny.
- Browser unsafe requests must send an Origin exactly matching `BABY_CARE_APP_ORIGIN`.
- Session cookie is `baby_care_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure=true` in HTTPS and false only for explicit local HTTP.
- Login throttling is in-memory: 10 attempts / 60 seconds / client address; client address is never persisted or audited.
- M1 stores date-only optional `birth_date`, never exact birth time.
- No feeding, diaper, sleep, Guardian, AI, bottle-volume, or other M2 care defaults/tables.
- Use existing compact diagnostic artifacts first on CI failure; raw logs only when compact evidence is insufficient.
- Each task uses RED -> GREEN -> focused verification -> commit. Do not restart completed tasks when a later task fails.

---

## File Structure

### Shared domain/contracts

- `packages/domain/src/identity.ts` — relationship and permission types.
- `packages/domain/src/policy.ts` — capability matrix only; no Fastify/DB dependency.
- `packages/domain/test/policy.test.ts` — complete admin/caregiver/public permission matrix.
- `packages/contracts/src/errors.ts` — stable M1 API error envelope/codes.
- `packages/contracts/src/auth.ts` — setup/login/session/password request/response schemas.
- `packages/contracts/src/family.ts` — family/baby/member safe DTO schemas.
- `packages/contracts/src/index.ts` — exports M1 contracts.

### API persistence/security

- `apps/api/src/schema.ts` — Drizzle definitions for families/users/memberships/babies/sessions/audit events.
- `migrations/0000_m1_family_identity.sql` — generated/checked-in M1 schema migration; if Drizzle generates a different numeric prefix, keep the generated numeric prefix and `m1_family_identity` name.
- `migrations/meta/_journal.json` and generated snapshot — Drizzle migration metadata.
- `apps/api/src/db.ts` — database creation plus migration entry point.
- `apps/api/src/auth/password.ts` — Argon2id hash/verify.
- `apps/api/src/auth/session-token.ts` — raw token generation + SHA-256 hashing.
- `apps/api/src/auth/login-limiter.ts` — ephemeral 10/60s limiter.
- `apps/api/src/auth/origin-guard.ts` — strict unsafe-method Origin check.
- `apps/api/src/auth/session-auth.ts` — cookie lookup, session validation, request auth context.
- `apps/api/src/audit/audit-repository.ts` — allowlisted append-only audit writes.
- `apps/api/src/family/family-repository.ts` — M1 DB queries/transactions.
- `apps/api/src/family/setup-service.ts` — one-time setup transaction.
- `apps/api/src/auth/auth-service.ts` — login/logout/password/session lifecycle.
- `apps/api/src/family/family-service.ts` — policy-protected family/baby/member operations.

### API routes/config

- `apps/api/src/routes/setup.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/family.ts`
- `apps/api/src/app.ts` — register cookie/origin/auth hooks and routes.
- `apps/api/src/config.ts` — add setup/origin/session settings.
- `apps/api/src/server.ts` — run migrations before listen.
- `.env.example` — document non-secret example configuration.

### Web

- `apps/web/src/api-client.ts` — typed same-origin JSON client with `credentials: include`.
- `apps/web/src/auth/types.ts` — UI state only.
- `apps/web/src/auth/SetupScreen.tsx`
- `apps/web/src/auth/LoginScreen.tsx`
- `apps/web/src/auth/AuthenticatedShell.tsx`
- `apps/web/src/family/AdminFamilyPanel.tsx`
- `apps/web/src/family/NannyFamilyView.tsx`
- `apps/web/src/App.tsx` — top-level state machine, not business logic.
- `apps/web/src/app.css` — M1 responsive/night-safe styles.

### End-to-end/CI

- `scripts/compose-smoke.mjs` — extend health smoke into M1 setup/login/authorization flow.
- `compose.yaml` — setup/origin config and API migrations.
- `infra/docker/api.Dockerfile` — include migrations in production image.
- `.github/workflows/ci.yml` — migration verification remains in integration/Compose jobs.

---

### Task 1: M1-A — Schema, migration, and DB migration runner

**Files:**
- Modify: `apps/api/src/schema.ts`
- Modify: `apps/api/src/db.ts`
- Modify: `apps/api/package.json`
- Create: `apps/api/test/migrations.integration.test.ts`
- Create/generated: `migrations/0000_m1_family_identity.sql`
- Create/generated: `migrations/meta/_journal.json`
- Create/generated: `migrations/meta/0000_snapshot.json`
- Modify: `infra/docker/api.Dockerfile`

**Interfaces:**
- Produces `families`, `users`, `familyMemberships`, `babies`, `sessions`, `auditEvents` Drizzle tables.
- Produces `DatabaseContext.migrate(): Promise<void>` used by server startup and tests.

- [ ] **Step 1: Write RED migration/schema tests**

Add a real-PostgreSQL integration test that calls `database.migrate()` against an empty test database and asserts the six M1 tables exist, then asserts DB constraints reject a second active family and a second baby for the same family.

```ts
it('migrates an empty database and enforces M1 singleton constraints', async () => {
  const database = createDatabase(process.env.TEST_DATABASE_URL!);
  await database.migrate();
  const tables = await database.pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  expect(new Set(tables.rows.map((row) => row.table_name))).toEqual(
    expect.objectContaining(new Set()),
  );
  // Follow with explicit INSERT/constraint assertions for active family and baby.
});
```

- [ ] **Step 2: Run RED test**

Run:

```bash
TEST_DATABASE_URL=postgres://babycare:babycare@127.0.0.1:5432/babycare_test \
  pnpm --filter @baby-care/api test -- migrations.integration.test.ts
```

Expected: FAIL because M1 tables/migration runner do not exist.

- [ ] **Step 3: Define Drizzle schema**

Use PostgreSQL UUID primary keys with `defaultRandom()`, timestamp-with-time-zone audit/session timestamps, date-only baby birth date, enum/check constraints for statuses/relationship/permission, and explicit indexes from the spec.

Singleton enforcement:

```sql
CREATE UNIQUE INDEX families_single_active_idx
ON families ((1))
WHERE status = 'active';

CREATE UNIQUE INDEX family_memberships_one_active_relationship_idx
ON family_memberships (family_id, relationship)
WHERE status = 'active';
```

Use `UNIQUE (family_id)` on `babies` and `UNIQUE (token_hash)` on sessions.

- [ ] **Step 4: Generate and inspect migration**

Run:

```bash
DATABASE_URL=postgres://babycare:babycare@127.0.0.1:5432/babycare \
  pnpm exec drizzle-kit generate --name m1_family_identity
```

Inspect the generated SQL and add the partial singleton indexes if Drizzle schema generation cannot express them directly. Do not hand-edit generated snapshot JSON except through regeneration.

- [ ] **Step 5: Add migration runner**

In `db.ts`, import the node-postgres Drizzle migrator and expose:

```ts
migrate: () => Promise<void>;
```

Implementation:

```ts
async migrate(): Promise<void> {
  await migrate(orm, { migrationsFolder: './migrations' });
}
```

Ensure production process working directory is `/app` and Docker image copies `migrations/`.

- [ ] **Step 6: Run GREEN integration test and existing API tests**

```bash
pnpm --filter @baby-care/api test -- migrations.integration.test.ts
pnpm --filter @baby-care/api test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/schema.ts apps/api/src/db.ts apps/api/package.json apps/api/test/migrations.integration.test.ts migrations infra/docker/api.Dockerfile pnpm-lock.yaml
git commit -m "feat: add M1 family identity schema"
```

---

### Task 2: M1-B — Domain policy and security primitives

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
export type Capability =
  | 'family.read' | 'family.update'
  | 'baby.read' | 'baby.update'
  | 'members.read' | 'members.manage'
  | 'credentials.reset_nanny';

export function can(permission: PermissionLevel, capability: Capability): boolean;
export async function hashPassword(password: string): Promise<string>;
export async function verifyPassword(hash: string, password: string): Promise<boolean>;
export function createSessionToken(): { raw: string; hash: string };
export function createLoginLimiter(options?: { limit: number; windowMs: number }): LoginLimiter;
export function assertAllowedOrigin(origin: string | undefined, expectedOrigin: string): void;
```

- [ ] **Step 1: Write RED policy/security tests**

Cover the full policy matrix plus:

```ts
expect(can('caregiver', 'family.update')).toBe(false);
expect(can('family_admin', 'credentials.reset_nanny')).toBe(true);
expect(createSessionToken().raw).not.toBe(createSessionToken().hash);
expect(() => assertAllowedOrigin(undefined, 'http://localhost:8080')).toThrow();
```

Password test must prove correct password succeeds and wrong password fails without comparing plaintext.

Limiter test uses an injected clock so the 11th attempt in 60 seconds is rejected and succeeds after the window advances.

- [ ] **Step 2: Run RED focused tests**

```bash
pnpm --filter @baby-care/domain test -- policy.test.ts
pnpm --filter @baby-care/api test -- security-primitives.test.ts
```

Expected: FAIL because interfaces are absent.

- [ ] **Step 3: Implement policy and primitives**

Use `argon2.hash(password, { type: argon2.argon2id })` and `argon2.verify`.

Session token:

```ts
const raw = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(raw).digest('hex');
```

Origin guard compares parsed URL `.origin` values exactly and throws a typed application error; never accepts `*`.

- [ ] **Step 4: Run GREEN tests**

Run the two focused commands above, then:

```bash
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain apps/api/src/auth apps/api/test/security-primitives.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat: add M1 auth security primitives"
```

---

### Task 3: M1-C — Shared API contracts, audit repository, and one-time setup

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

export interface SetupService {
  isRequired(): Promise<boolean>;
  initialize(input: SetupInput, traceId: string): Promise<void>;
}
```

Setup token transport: `x-baby-care-setup-token` header. The value is never copied into logs or diagnostics.

- [ ] **Step 1: Write RED contract and setup tests**

Contract tests validate normalized shape and password length 10–128 characters without composition rules.

Integration flow:

```ts
const first = await app.inject({
  method: 'POST',
  url: '/api/setup',
  headers: {
    origin: 'http://localhost:8080',
    'x-baby-care-setup-token': 'test-setup-secret',
  },
  payload: { familyName: 'Xiangxiang Family', babyDisplayName: 'xiangxiang', dad: ..., mom: ... },
});
expect(first.statusCode).toBe(201);

const second = await app.inject({ /* same shape */ });
expect(second.statusCode).toBe(409);
expect(second.json().code).toBe('setup_closed');
```

Assert DB contains family, baby, Dad/Mom memberships, and `family.setup_completed` audit event.

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @baby-care/contracts test -- m1-contracts.test.ts
pnpm --filter @baby-care/api test -- setup.integration.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement config and setup service**

Extend config with:

```ts
BABY_CARE_APP_ORIGIN: z.string().url(),
BABY_CARE_SETUP_TOKEN: z.string().min(16),
SESSION_SECURE: z.coerce.boolean().default(false),
```

`initialize()` hashes Dad/Mom passwords before a single DB transaction and inserts family/baby/users/memberships/audit. Database singleton constraints remain the final race-condition guard.

- [ ] **Step 4: Register setup routes and error envelope**

`GET /api/setup/status` returns only `{ required }`.

For `POST /api/setup`:

1. Origin guard.
2. If already initialized, return `setup_closed` before comparing token.
3. Constant-time compare setup token.
4. Validate payload.
5. Transactional setup.
6. Return 201 without password/session fields.

- [ ] **Step 5: Run GREEN tests**

```bash
pnpm --filter @baby-care/contracts test -- m1-contracts.test.ts
pnpm --filter @baby-care/api test -- setup.integration.test.ts
pnpm --filter @baby-care/api test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts apps/api/src/audit apps/api/src/family apps/api/src/routes/setup.ts apps/api/src/config.ts apps/api/src/app.ts apps/api/test/setup.integration.test.ts .env.example
git commit -m "feat: add one-time family setup"
```

---

### Task 4: M1-D — Server session authentication lifecycle

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

export interface AuthService {
  login(loginName: string, password: string, now: Date): Promise<LoginResult>;
  authenticate(rawToken: string, now: Date): Promise<AuthContext | null>;
  logout(rawToken: string, now: Date): Promise<void>;
  changePassword(context: AuthContext, currentPassword: string, nextPassword: string, now: Date): Promise<LoginResult>;
}
```

- [ ] **Step 1: Write RED auth lifecycle integration tests**

After setup, prove:

- wrong login returns identical `invalid_credentials` for wrong user and wrong password;
- correct Dad login sets `baby_care_session` HttpOnly/Lax cookie;
- DB stores token hash, never raw cookie token;
- `/api/auth/session` returns Dad safe context;
- logout invalidates session;
- password change invalidates old cookie and returns a new valid cookie;
- disabled membership invalidates an otherwise unexpired session.

- [ ] **Step 2: Run RED test**

```bash
pnpm --filter @baby-care/api test -- auth.integration.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Register cookie support and auth hook**

Use `@fastify/cookie`; never expose cookie to client JS. Parse the raw cookie token, SHA-256 it, then query sessions + active user + active membership.

- [ ] **Step 4: Implement login limiter and auth routes**

Login uses limiter before expensive Argon2 verification. Failed audit event uses singleton family ID, actor null, and no raw submitted login/IP metadata.

`change-password` performs password update + revoke all existing sessions + create one replacement session transactionally where practical.

- [ ] **Step 5: Run GREEN tests and security regression**

```bash
pnpm --filter @baby-care/api test -- auth.integration.test.ts security-primitives.test.ts
pnpm --filter @baby-care/api test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/package.json apps/api/test/auth.integration.test.ts pnpm-lock.yaml
git commit -m "feat: add server-side family sessions"
```

---

### Task 5: M1-E — Policy-protected family, baby, and Nanny management

**Files:**
- Create: `apps/api/src/family/family-service.ts`
- Create: `apps/api/src/routes/family.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/test/family-authorization.integration.test.ts`
- Modify: `packages/contracts/src/family.ts`
- Modify: `packages/contracts/test/m1-contracts.test.ts`

**Interfaces:**

```ts
export interface FamilyService {
  getFamily(context: AuthContext): Promise<FamilyDto>;
  updateFamily(context: AuthContext, input: UpdateFamilyInput, traceId: string): Promise<FamilyDto>;
  getBaby(context: AuthContext): Promise<BabyDto>;
  updateBaby(context: AuthContext, input: UpdateBabyInput, traceId: string): Promise<BabyDto>;
  listMembers(context: AuthContext): Promise<MemberDto[]>;
  createNanny(context: AuthContext, input: CreateNannyInput, traceId: string): Promise<MemberDto>;
  setNannyStatus(context: AuthContext, membershipId: string, status: 'active' | 'disabled', traceId: string): Promise<MemberDto>;
  resetNannyPassword(context: AuthContext, membershipId: string, newPassword: string, traceId: string): Promise<void>;
}
```

- [ ] **Step 1: Write RED authorization matrix integration tests**

Create Dad and Nanny sessions. Prove:

```text
Dad GET family -> 200
Nanny GET family -> 200 safe projection
Dad PATCH family -> 200
Nanny PATCH family -> 403 forbidden
Dad PATCH baby -> 200
Nanny PATCH baby -> 403 forbidden
Dad POST Nanny -> 201
Nanny POST member -> 403 forbidden
Dad reset Nanny password -> 204 + old Nanny sessions invalid
Dad attempts reset Mom password -> 403 forbidden
```

- [ ] **Step 2: Run RED test**

```bash
pnpm --filter @baby-care/api test -- family-authorization.integration.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement FamilyService policy guards**

Every mutating method calls the framework-free `can()` policy before DB work. Route UI visibility is not a security boundary.

Safe member DTO contains only:

```ts
{ membershipId, displayName, relationship, permissionLevel, status }
```

No login name or credential state is returned to caregiver views unless later explicitly required.

- [ ] **Step 4: Implement Nanny lifecycle**

Create only `nanny/caregiver`. Reject second active Nanny with `member_already_exists`. Disable/re-enable keeps history. Reset password hashes new password and revokes all Nanny sessions.

- [ ] **Step 5: Run GREEN tests**

```bash
pnpm --filter @baby-care/api test -- family-authorization.integration.test.ts
pnpm --filter @baby-care/domain test
pnpm --filter @baby-care/api test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/family apps/api/src/routes/family.ts apps/api/src/app.ts apps/api/test/family-authorization.integration.test.ts packages/contracts
git commit -m "feat: enforce family caregiver permissions"
```

---

### Task 6: M1-F — Audit completeness and secret-redaction regression

**Files:**
- Modify: `apps/api/src/audit/audit-repository.ts`
- Modify: setup/auth/family services from Tasks 3–5
- Create: `apps/api/test/audit.integration.test.ts`
- Create: `packages/observability/test/m1-secret-redaction.test.ts` only if redaction logic belongs in shared observability; otherwise keep all checks in API audit test.

**Interfaces:**

Audit writer accepts explicit safe fields only:

```ts
writeAudit({
  familyId,
  actorUserId,
  actorMembershipId,
  action,
  targetType,
  targetId,
  source,
  traceId,
  metadata,
}): Promise<void>
```

Do not offer a generic `metadata: Record<string, unknown>` passthrough from HTTP bodies.

- [ ] **Step 1: Write RED audit tests**

Exercise setup, failed login, successful login, logout, own password change, Nanny create/disable/enable/reset, family update, baby update.

Assert exact required action names are present and serialized audit rows do not contain known test secrets:

```ts
const serialized = JSON.stringify(rows);
expect(serialized).not.toContain('DadSecretPassword');
expect(serialized).not.toContain('raw-session-token');
expect(serialized).not.toContain('setup-secret');
expect(serialized).not.toContain('203.0.113.');
```

- [ ] **Step 2: Run RED test**

```bash
pnpm --filter @baby-care/api test -- audit.integration.test.ts
```

Expected: FAIL for missing audit actions/redaction boundaries.

- [ ] **Step 3: Add missing audit writes with allowlisted metadata**

Audit failures must not convert successful user operations into 500 after the primary DB transaction has committed; for operations whose audit event is a required security invariant, write business change + audit in the same transaction.

- [ ] **Step 4: Run GREEN tests**

```bash
pnpm --filter @baby-care/api test -- audit.integration.test.ts
pnpm --filter @baby-care/api test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/api/test/audit.integration.test.ts packages/observability/test || true
git commit -m "feat: complete M1 identity audit trail"
```

---

### Task 7: M1-G — Web setup/login/authenticated family shell

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
- Replace/extend: `apps/web/test/App.test.tsx`

**Interfaces:**

`api-client.ts` exposes typed functions:

```ts
getSetupStatus()
setupFamily(input, setupToken)
login(loginName, password)
logout()
getSession()
getFamily()
updateFamily(input)
getBaby()
updateBaby(input)
listMembers()
createNanny(input)
setNannyStatus(id, status)
resetNannyPassword(id, newPassword)
```

All fetch calls use relative `/api/...` URLs and `credentials: 'include'`. Unsafe browser requests automatically include `Origin` through the browser; tests mock fetch rather than manually spoofing browser Origin.

- [ ] **Step 1: Write RED App state tests**

Cover:

1. setup required -> setup form shows `xiangxiang` default;
2. setup token input is password-like and not persisted;
3. initialized + unauthenticated -> login screen;
4. Dad session -> admin controls visible;
5. Nanny session -> read-only family view, no admin buttons;
6. generic invalid-credentials copy;
7. no labels/text pretending last feed/sleep state exists.

- [ ] **Step 2: Run RED Web tests**

```bash
pnpm --filter @baby-care/web test
```

Expected: FAIL.

- [ ] **Step 3: Implement a small top-level state machine**

Use states such as:

```ts
type AppState =
  | { kind: 'checking' }
  | { kind: 'setup-required' }
  | { kind: 'login' }
  | { kind: 'authenticated'; session: SessionDto }
  | { kind: 'degraded' };
```

Do not add React Router in M1. Keep forms/components focused and reusable.

- [ ] **Step 4: Implement admin/Nanny projections**

Dad/Mom can edit family/baby and manage Nanny. Nanny gets read-only baby/family/member context. API 403 remains authoritative even if UI controls are hidden.

- [ ] **Step 5: Run GREEN Web tests/build**

```bash
pnpm --filter @baby-care/web test
pnpm --filter @baby-care/web typecheck
pnpm --filter @baby-care/web build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add M1 family identity workspace"
```

---

### Task 8: M1-H — Production migration/startup and Compose authorization smoke

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `compose.yaml`
- Modify: `infra/docker/api.Dockerfile`
- Modify: `scripts/compose-smoke.mjs`
- Modify: `.github/workflows/ci.yml` only if integration job needs an explicit migration command/evidence file.
- Create: `apps/api/test/startup.integration.test.ts` if startup migration behavior is not fully covered elsewhere.

**Interfaces:**

Production startup order:

```text
load validated config
 -> connect PostgreSQL
 -> apply checked-in migrations
 -> build Fastify app/services
 -> listen
```

- [ ] **Step 1: Write RED startup/Compose expectations**

Update smoke script to maintain a tiny cookie jar by reading `set-cookie` and sending the cookie header on later Node `fetch` calls.

Smoke helper:

```js
async function request(path, { method = 'GET', body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (method !== 'GET' && method !== 'HEAD') headers.origin = APP_ORIGIN;
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  return fetch(`${BASE_URL}${path}`, { method, headers, body: body && JSON.stringify(body) });
}
```

The smoke must fail before M1 production wiring exists.

- [ ] **Step 2: Configure Compose M1 environment**

Use non-production test values only in Compose defaults/CI:

```text
BABY_CARE_APP_ORIGIN=http://127.0.0.1:8080
BABY_CARE_SETUP_TOKEN=local-development-setup-token-change-me
SESSION_SECURE=false
```

Do not put a real family secret in git. Production deployment will override values.

- [ ] **Step 3: Run migrations before listen**

Server startup must fail clearly if migrations fail and never listen on a partially migrated DB.

- [ ] **Step 4: Implement complete production smoke**

Assert this exact flow through Nginx `/api` proxy:

```text
GET setup/status -> required true
POST setup -> 201
POST Dad login -> cookie
GET session -> dad/family_admin
POST create Nanny -> 201
POST Nanny login -> cookie
GET baby as Nanny -> 200
PATCH family as Nanny -> 403 forbidden
PATCH family as Dad -> 200
```

- [ ] **Step 5: Run focused Compose smoke**

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down -v --remove-orphans
```

Expected: PASS from an empty volume.

- [ ] **Step 6: Run full software gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: PASS before pushing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/server.ts compose.yaml infra/docker/api.Dockerfile scripts/compose-smoke.mjs .github/workflows/ci.yml apps/api/test/startup.integration.test.ts
git commit -m "test: verify M1 production family flow"
```

---

### Task 9: M1-I — Final review, milestone state, and Draft PR

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `.agent/current-milestone.json`
- Modify: `agent.md` only if M1 produced a genuinely cross-cutting long-lived rule not already captured.

**Interfaces:**
- Produces M1 release evidence and next milestone state `M2 Care Recording MVP — waiting_for_real_care_habits`.

- [ ] **Step 1: Run final GitHub public-runner release gate on final code head**

Required jobs:

```text
static
unit
integration (real PostgreSQL + migrations)
build
compose-smoke (production containers + M1 auth flow)
```

Do not mark M1 complete from an older run.

- [ ] **Step 2: Review final diff against M1 spec**

Check explicitly:

- no feeding/diaper/sleep/Guardian tables or UI defaults;
- no raw secrets/tokens in repo/logging/audit fixtures;
- policy enforcement is server-side;
- Nanny cannot perform admin mutations;
- session reset/rotation rules match spec;
- migration starts from empty DB;
- all new public API shapes have contract tests.

Fix Critical/Important findings before continuing.

- [ ] **Step 3: Update compact milestone state**

Set:

```json
{
  "milestone": "M2 Care Recording MVP",
  "status": "waiting_for_real_care_habits",
  "completed_milestones": [
    "M0 Repository and delivery foundation",
    "M1 Family and baby foundation"
  ],
  "m2_real_care_habits_gate": "user_input_required_before_design"
}
```

Update `docs/PLAN.md` with M1 verification run ID and next required user input categories, without duplicating the full M1 spec.

- [ ] **Step 4: Re-run final CI if state/docs changes trigger the workflow**

Require the final branch head to have fresh success evidence. Documentation-only changes still must not leave the PR head unverified.

- [ ] **Step 5: Open/update Draft PR**

If M0 PR is not yet merged, target the M1 PR at `codex/m0-delivery-foundation` so reviewers see only M1 delta. If M0 is merged before this step, target `main`.

PR body must list:

- M1 scope;
- explicit non-goals;
- final head SHA;
- final 5-job CI run ID;
- M2 care-habits gate remains blocked pending user input.

Do not merge `main` without explicit user approval.
