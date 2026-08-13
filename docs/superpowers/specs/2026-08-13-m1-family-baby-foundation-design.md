# M1 Family and Baby Foundation Design

Status: approved design, written spec pending final user review  
Milestone: M1 — Family and baby foundation  
Repository: `lpearf-pixel/baby-care`  
Branch: `codex/m1-family-baby-foundation`  
Date: 2026-08-13

Read `/agent.md` and `docs/PLAN.md` before this file.

## 1. Goal

M1 establishes trustworthy family identity, baby identity, authorization, session security, and audit attribution before any care-recording feature exists.

M1 succeeds when:

- one family can be initialized exactly once;
- `xiangxiang` exists as the family's baby profile;
- Dad, Mom, and Nanny have separate accounts;
- Dad and Mom have family-admin authority;
- Nanny has caregiver-only authority;
- every authenticated action can be attributed to a concrete user and trace ID;
- password/session lifecycle is safe enough for family LAN testing and portable to later HTTPS deployment;
- no feeding, diaper, sleep, Guardian, or AI interaction assumptions are introduced.

## 2. Non-goals

M1 does **not** implement:

- feeding, bottle-volume, breastfeeding, diaper, stool, sleep, cry, spit-up, or weight records;
- care quick-entry defaults;
- Guardian ingestion or AI/model orchestration;
- email/SMS verification;
- OAuth/social login;
- email-based password recovery;
- public signup;
- multiple families or multiple babies;
- native applications or WeChat Mini Program.

The M2 real-care-habits gate remains mandatory before care interaction defaults are designed.

## 3. Chosen approach

Use **separate user accounts with server-side database sessions**.

Rejected alternatives:

1. Shared family password + role picker: simpler, but cannot reliably attribute actions to a person and undermines audit/handoff integrity.
2. JWT + refresh tokens: useful for broad third-party APIs, but adds token refresh/revocation complexity without current benefit for one same-origin family PWA.

Server-side sessions give M1 immediate revocation, simple logout/reset semantics, and clear audit attribution.

## 4. Core model

M1 introduces six core persistence concepts.

### 4.1 `families`

Fields:

```text
id
name
timezone
status: active
created_at
updated_at
```

Rules:

- M1 supports exactly one active family.
- Default timezone is `Asia/Shanghai` unless setup explicitly changes it.
- Family deletion is out of scope.

### 4.2 `users`

Fields:

```text
id
login_name
display_name
password_hash
status: active | disabled
created_at
updated_at
```

Rules:

- `login_name` is normalized before storage and comparison and is unique.
- `display_name` is not required to be a legal name.
- Default setup display names may be `Dad`, `Mom`, and later `Nanny`.
- Passwords are stored only as Argon2id hashes.
- Raw passwords never enter logs, audit metadata, diagnostics, or API responses.

### 4.3 `family_memberships`

Fields:

```text
id
family_id
user_id
relationship: dad | mom | nanny
permission_level: family_admin | caregiver
status: active | disabled
created_at
updated_at
```

Mapping:

```text
dad   -> family_admin
mom   -> family_admin
nanny -> caregiver
```

Rules:

- identity/relationship and authorization level are separate concepts;
- Dad and Mom share the same authorization policy even though the UI relationship labels differ;
- M1 setup creates exactly one active Dad membership and one active Mom membership;
- after setup, family admins may create one active Nanny account;
- adding more admins or arbitrary new relationship types is deferred.

### 4.4 `babies`

Fields:

```text
id
family_id
display_name
birth_date nullable DATE
status: active
created_at
updated_at
```

Rules:

- M1 supports one baby per family;
- initial `display_name` is `xiangxiang`;
- `birth_date` is nullable until the baby is born and stores date only, not precise birth time;
- M1 stores no medical identifiers or care preferences.

### 4.5 `sessions`

Fields:

```text
id
family_id
user_id
token_hash
created_at
expires_at
last_seen_at
revoked_at nullable
```

Rules:

- the browser receives a cryptographically random session token with at least 256 bits of entropy;
- the database stores only `SHA-256(token)`, never the raw token;
- default absolute session lifetime is 30 days;
- disabled users/memberships cannot authenticate even if an unexpired session row exists;
- logout revokes the current session;
- password change revokes **all existing sessions including the old current session**, then issues one new current session token;
- admin reset of Nanny credentials revokes every Nanny session and does not auto-login the Nanny;
- session rows are retained long enough for audit/debugging but raw tokens are never recoverable.

Cookie policy:

```text
HttpOnly = true
SameSite = Lax
Path = /
Secure = true under HTTPS
Secure = false only in explicitly configured local HTTP development
```

Cookie name: `baby_care_session`.

The raw session token exists only in the HttpOnly cookie and transient server request memory. It is never stored in browser local/session storage.

### 4.6 `audit_events`

Fields:

```text
id
family_id
actor_user_id nullable for system/setup/failed-login
actor_membership_id nullable
action
target_type
target_id nullable
source: web | api | system
trace_id
metadata_json nullable
occurred_at
```

Rules:

- audit events are append-only through normal application APIs;
- metadata uses an allowlist; never store password, session token, setup token, precise network secrets, raw login identifiers from failed authentication, client IP addresses, or raw authorization/cookie headers;
- authentication/admin actions always create audit evidence;
- later care records will reuse the same actor/source/trace semantics instead of inventing a second attribution model.

## 5. First-run setup

### 5.1 Setup state

`GET /api/setup/status`

Response exposes only whether initialization is required:

```json
{ "required": true }
```

It does not expose family/user details.

### 5.2 Setup authorization

`POST /api/setup` requires a request setup token matching `BABY_CARE_SETUP_TOKEN` from environment configuration.

Requirements:

- compare the supplied secret without logging it;
- if a family already exists, return `409 setup_closed` regardless of the supplied token;
- initialization is transactional;
- a failed transaction leaves the database in uninitialized state.

### 5.3 Setup transaction

One successful setup creates:

1. one Family;
2. baby profile `xiangxiang`;
3. Dad user + `dad/family_admin` membership;
4. Mom user + `mom/family_admin` membership;
5. setup audit event.

Nanny is created later by Dad or Mom from family administration.

There is no public registration endpoint after setup.

## 6. Authentication flow

### 6.1 Login

`POST /api/auth/login`

Input:

```text
login_name
password
```

Behavior:

- normalize login name;
- load active user and active membership;
- verify Argon2id password;
- on success create server-side session and set cookie;
- on any credential failure return the same generic `401 invalid_credentials` response;
- do not reveal whether login name or password was wrong.

Failed-login throttling is in-memory and limited to **10 login attempts per 60 seconds per client address**. The address may be used only as an ephemeral limiter key and must not be persisted or placed into audit/diagnostic metadata. Persistent account lockout is intentionally deferred to avoid creating a family lockout recovery problem in M1.

### 6.2 Current session

`GET /api/auth/session`

Returns only safe identity context needed by the client:

```text
user_id
display_name
relationship
permission_level
family_id
family_name
baby_id
baby_display_name
```

No credential/session hash fields are returned.

### 6.3 Logout

`POST /api/auth/logout`

Revokes the current session and clears the cookie. Repeating logout is safe/idempotent from the client's perspective.

### 6.4 Change own password

`POST /api/auth/change-password`

Requires current password plus new password.

On success, in one logical operation:

1. replace the Argon2id password hash;
2. revoke all existing sessions for the user, including the request's old current session;
3. create one new session and replace the browser cookie;
4. emit the password-changed audit event.

## 7. Authorization policy

Authorization logic belongs in a reusable Policy/Auth layer, not scattered route-local role strings.

### 7.1 Public/unauthenticated

Allowed:

- health endpoint;
- setup status;
- setup only while uninitialized and with setup token;
- login.

Everything else requires an active session and active membership.

### 7.2 `family_admin` — Dad/Mom

Allowed:

- read and edit Family display settings/timezone;
- read and edit `xiangxiang` basic profile;
- list family members;
- create the Nanny account;
- disable/enable Nanny membership;
- reset Nanny password;
- use own session/logout/password-change functions.

Not allowed in M1:

- reset another family admin's password;
- delete another family admin;
- create arbitrary new admin accounts;
- access nonexistent M2 care/Guardian functions.

This avoids silent lateral takeover between Dad and Mom while still allowing either admin to operate the family workspace.

### 7.3 `caregiver` — Nanny

Allowed:

- read `xiangxiang` basic profile;
- read non-sensitive family display context;
- read a safe member directory containing display name/relationship/status needed for handoff attribution;
- use own session/logout/password-change functions.

Not allowed:

- edit Family settings;
- edit baby profile;
- create/disable members;
- reset credentials;
- access export, Guardian admin, private medical/admin settings when those features exist later.

### 7.4 Authorization response

Authenticated but unauthorized requests return a stable `403 forbidden` envelope. Missing/invalid sessions return stable `401 unauthenticated`.

## 8. Family and baby API

M1 endpoints:

```text
GET   /api/setup/status
POST  /api/setup

POST  /api/auth/login
POST  /api/auth/logout
GET   /api/auth/session
POST  /api/auth/change-password

GET   /api/family
PATCH /api/family

GET   /api/baby
PATCH /api/baby

GET   /api/family/members
POST  /api/family/members
PATCH /api/family/members/:membershipId/status
POST  /api/family/members/:membershipId/reset-password
```

Constraints:

- `POST /api/family/members` creates only a `nanny/caregiver` member in M1;
- M1 allows only one active Nanny membership at a time;
- `reset-password` applies only to caregiver/Nanny in M1;
- write endpoints require same-origin request validation in addition to cookie authentication;
- API errors use stable machine-readable codes and preserve request `x-trace-id` behavior from M0.

## 9. CSRF / same-origin protection

Cookie authentication requires protection against cross-site state-changing requests.

For all browser-facing unsafe methods (`POST`, `PATCH`, `PUT`, `DELETE`):

- require an `Origin` header;
- require exact scheme/host/port match with configured `BABY_CARE_APP_ORIGIN`;
- reject a missing or mismatched Origin with `403 origin_not_allowed`;
- keep `SameSite=Lax` session cookies;
- do not enable broad CORS in M1.

Tests and Compose probes must send the configured Origin on unsafe requests. This is intentionally simpler than introducing a separate CSRF token protocol while Baby Care is a same-origin Web/PWA.

## 10. Web/PWA experience

M1 adds only identity/family UI required for real family testing.

### First-run state

- setup screen when `/api/setup/status` says initialization is required;
- inputs for family name, Dad login/password, Mom login/password;
- baby display name defaults to `xiangxiang`;
- setup token is entered deliberately and never persisted in local storage.

### Login state

- login screen;
- generic invalid-credentials error;
- no account-enumeration hints.

### Authenticated shell

Always show current safe identity context:

```text
xiangxiang
Dad / Mom / Nanny
```

Admin UI:

- family settings;
- baby basic profile;
- member management;
- create/disable/reset Nanny credentials.

Nanny UI:

- read-only baby/family context;
- safe member directory;
- no admin controls rendered.

Home remains a system/current-identity shell. It must not invent care state such as "last feed" or "sleeping" before M2/M3 data exists.

## 11. Error and state handling

Stable application errors introduced in M1 should include at least:

```text
setup_closed
setup_token_invalid
invalid_credentials
unauthenticated
forbidden
origin_not_allowed
login_name_conflict
member_already_exists
member_disabled
validation_failed
```

Rules:

- client-facing messages are understandable to family users;
- API codes remain stable for tests/agents;
- internal stack traces and secrets never enter browser responses;
- errors retain trace ID so compact diagnostics can locate the failing request.

## 12. Database/migration rules

M1 is the first milestone that introduces real application tables.

Requirements:

- create explicit SQL/Drizzle migrations checked into `migrations/`;
- migration runs against an empty PostgreSQL database in CI;
- schema constraints enforce uniqueness/referential integrity where practical;
- setup transaction relies on DB constraints, not only application checks;
- disabling users/memberships does not delete audit/history rows;
- no destructive down migration is required for family data during normal runtime;
- development reset may drop disposable test databases only.

Important indexes/constraints:

- unique stored normalized `users.login_name`;
- one membership per `(family_id, user_id)`;
- partial uniqueness prevents more than one active Dad, Mom, or Nanny relationship for the family;
- a PostgreSQL partial unique singleton constraint/index prevents more than one active Family in M1;
- unique `babies.family_id` enforces one baby per family in M1;
- unique `sessions.token_hash`;
- indexes on `sessions.user_id`, `sessions.expires_at`, `audit_events.family_id`, and `audit_events.occurred_at`.

## 13. Audit actions

At minimum emit:

```text
family.setup_completed
auth.login_succeeded
auth.login_failed
auth.logout
auth.password_changed
member.nanny_created
member.nanny_disabled
member.nanny_enabled
member.nanny_password_reset
family.updated
baby.updated
```

For `auth.login_failed`, use the existing singleton family ID with `actor_user_id = null`; do not persist the submitted login name, password, or client address in audit metadata.

## 14. Testing strategy

M1 keeps the segmented M0 CI model.

### Focused/unit tests

- password hashing/verification contract;
- session token hashing and expiry/revocation;
- password-change session rotation;
- policy matrix for admin/caregiver/public;
- setup state rules;
- stable auth/error envelopes;
- strict Origin guard;
- login throttling boundary;
- audit metadata redaction.

### PostgreSQL integration

Use real PostgreSQL to verify:

- migrations apply from empty DB;
- setup transaction creates exactly the intended records;
- second setup is rejected;
- login creates usable session;
- disabled membership invalidates access;
- password change rotates the current session and invalidates all older sessions;
- Nanny password reset invalidates all Nanny sessions;
- membership/login/singleton uniqueness constraints;
- audit rows are written for security/admin changes.

### Web tests

- first-run setup UI;
- login UI;
- authenticated Dad/Mom/Nanny shell;
- admin controls absent for Nanny;
- generic auth failure copy;
- no care-state placeholders introduced.

### Compose smoke

Production Compose smoke should exercise a bounded real flow:

```text
empty DB
 -> setup Dad/Mom + xiangxiang
 -> Dad login
 -> read session/family/baby
 -> create Nanny
 -> Nanny login
 -> Nanny read allowed context
 -> Nanny admin write returns 403
 -> Dad admin write succeeds
```

All unsafe requests in this flow send the configured Origin.

CI remains:

```text
static
unit
PostgreSQL integration
production build
production Compose smoke
```

On failure, compact diagnostic artifacts remain first-line evidence; full raw logs are fallback only.

## 15. Security/privacy invariants

- never log raw passwords, setup token, session token, cookie header, authorization secrets, or client IP addresses;
- session DB rows contain token hashes only;
- setup token exists only in environment + transient request memory;
- no legal names are required;
- no home address, hospital location, medical IDs, camera endpoints, or network credentials enter M1 domain models;
- exact birth time is not stored;
- audit metadata uses explicit allowlists;
- production HTTPS enables Secure cookies without application redesign.

## 16. Delivery segmentation

Implementation should be split so each segment is restartable and independently testable:

```text
M1-A  migrations + repository layer
M1-B  password/session primitives
M1-C  setup transaction/API
M1-D  authentication/session API
M1-E  policy + family/baby/member API
M1-F  audit integration
M1-G  Web setup/login/family shell
M1-H  production Compose end-to-end flow
M1-I  review + release gate
```

Each segment uses RED -> GREEN -> focused/module CI. Ordinary reversible failures are repaired automatically from compact evidence.

## 17. Definition of Done

M1 is complete only when:

- schema/migrations are committed and verified on empty PostgreSQL;
- one-time setup works and is permanently closed afterward;
- Dad/Mom/Nanny use separate credentials;
- server-side session lifecycle and revocation/rotation rules pass tests;
- policy matrix is enforced by API, not only hidden in UI;
- Nanny cannot perform family-admin writes;
- security/admin actions produce attributable audit events;
- Web/PWA supports setup/login/identity/member administration needed for family testing;
- no M2 care defaults or tables have been introduced;
- static, unit, PostgreSQL integration, production build, and production Compose smoke all pass at final head;
- final diff review finds no Important/Critical issue;
- M1 state is persisted in `docs/PLAN.md` and `.agent/current-milestone.json`.
