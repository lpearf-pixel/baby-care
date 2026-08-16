# M2 Care Recording MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved M2 newborn care recorder for `xiangxiang`: mixed feeding, diaper/stool, sleep backfill, burping/spit-up/crying/bathing, temperature/weight/medication facts, deterministic warnings and recent-volume shortcuts, edit/undo, rolling 24-hour summary, and a fast Web/PWA recording flow.

**Architecture:** Implement on `codex/m2-care-recording-implementation`, created directly from verified M1 HEAD `76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`. Add one normalized `care_events` envelope with typed PostgreSQL child tables, deterministic care rules in `packages/domain`, strict Zod DTOs in `packages/contracts`, focused Fastify services/routes in `apps/api`, and small React care modules in `apps/web/src/care`. M1 authentication/authorization remains authoritative; normal manual care writes derive family/baby/actor/source on the server and never trust ownership fields from the client.

**Tech Stack:** Node 24+, TypeScript, pnpm 10.17.1, Fastify, PostgreSQL 16, Drizzle ORM/Kit, Zod, React/Vite PWA, Vitest, Testing Library, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Approved product design: `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`, copied unchanged from `codex/m2-care-recording-mvp @ eadb8f1d41770b5ef940f16993e57a4cb8ee6bc5`.
- M1-H is already closed. Authoritative M1 HEAD is `76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`; CI run `31707486985` is 5/5 PASS. The historical prerequisite text in design section 21 is satisfied and must not be reimplemented.
- Do not modify or merge `main`.
- Bottle capacities 90/150/200 ml are container metadata only. They never become intake shortcuts and never contribute to intake totals.
- Bottle liquid types are exactly `expressed_breast_milk` and `formula`.
- Direct breastfeeding records total session minutes only; no left/right breast timer and no inferred ml.
- Dynamic bottle shortcuts are per liquid type: newest 20 active bottle components, exact-ml frequency descending, tie by most recent use descending, top 3 unique values.
- Sleep UI offers now / 10 / 20 / 30 minutes ago / custom. `occurredAt` more than 5 minutes in the future is invalid. A backfill more than 24 hours old is allowed only after an `old_backfill` soft confirmation.
- Duplicate warnings are deterministic, conservative, and never silently merge records.
- Every manual write includes `clientRequestId: UUID`. Same authenticated family + actor + clientRequestId is idempotent and returns the existing result.
- Manual request schemas are strict and do not expose `familyId`, `babyId`, `actorUserId`, `actorMembershipId`, or `source`. Server derives them from the M1 session and sets `source='manual'`.
- Medication stores administered facts only; never calculate, prescribe, or recommend a dose.
- Nanny handoff schedule remains unset. Do not hard-code a shift window.
- Guardian, JoyAI, Qwen, automated feeding recognition, full offline sync, M3 handoff UX, and advanced trend dashboards are out of scope.
- Normal segment flow: RED test -> verify RED -> minimal implementation -> focused GREEN -> commit -> CI when the segment materially crosses module/runtime boundaries.
- Final M2 status files must be committed before the exact-final-head 5-job CI.

---

## File Map

### Shared contracts

Create:

- `packages/contracts/src/care/common.ts` — common care envelope/write/warning DTOs.
- `packages/contracts/src/care/feeding.ts` — feeding session and component DTOs.
- `packages/contracts/src/care/diaper.ts` — diaper/stool DTOs.
- `packages/contracts/src/care/sleep.ts` — sleep start/wake DTOs.
- `packages/contracts/src/care/actions.ts` — burping/spit-up/crying/bathing/medication DTOs.
- `packages/contracts/src/care/measurements.ts` — temperature/weight DTOs.
- `packages/contracts/src/care/query.ts` — summary/timeline/quick-value DTOs.
- `packages/contracts/src/care/revisions.ts` — typed edit/undo DTOs.
- `packages/contracts/src/care/index.ts` — care exports.

Modify:

- `packages/contracts/src/errors.ts` — add care error codes and privacy-safe optional details.
- `packages/contracts/src/index.ts` — export care package.

### Domain rules

Create:

- `packages/domain/src/care/quick-values.ts`
- `packages/domain/src/care/time.ts`
- `packages/domain/src/care/warnings.ts`
- `packages/domain/src/care/index.ts`

Modify:

- `packages/domain/src/identity.ts` — add `care.read` / `care.write`.
- `packages/domain/src/policy.ts` — caregiver may perform normal care operations but still cannot administer family settings.
- `packages/domain/src/index.ts` — export care rules.

### API

Create under `apps/api/src/care/`:

- `care-auth.ts`
- `care-errors.ts`
- `care-event-repository.ts`
- `feeding-service.ts`
- `diaper-service.ts`
- `sleep-service.ts`
- `action-service.ts`
- `measurement-service.ts`
- `query-service.ts`
- `revision-service.ts`

Create under `apps/api/src/routes/`:

- `care-feeding.ts`
- `care-diaper.ts`
- `care-sleep.ts`
- `care-actions.ts`
- `care-measurements.ts`
- `care-query.ts`
- `care-revisions.ts`

Modify:

- `apps/api/src/schema.ts`
- `apps/api/src/app.ts`
- generated `migrations/0001_m2_care_recording.sql`
- generated `migrations/meta/*`

### Web/PWA

Create under `apps/web/src/care/`:

- `CareWorkspace.tsx`
- `CareSummary.tsx`
- `QuickRecordBar.tsx`
- `FeedingForm.tsx`
- `DiaperForm.tsx`
- `SleepControls.tsx`
- `OtherCareForm.tsx`
- `RecentRecordCard.tsx`
- `CareWarningDialog.tsx`
- `useCareWorkspace.ts`

Modify:

- `apps/web/src/api-client.ts`
- `apps/web/src/auth/AuthenticatedShell.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/app.css`

### Tests and release

Create/modify:

- `packages/contracts/test/care-contracts.test.ts`
- `packages/domain/test/care-policy.test.ts`
- `packages/domain/test/care-rules.test.ts`
- `apps/api/test/m2-migrations.integration.test.ts`
- `apps/api/test/care-event.integration.test.ts`
- `apps/api/test/feeding.integration.test.ts`
- `apps/api/test/diaper-sleep.integration.test.ts`
- `apps/api/test/care-actions.integration.test.ts`
- `apps/api/test/care-query.integration.test.ts`
- `apps/api/test/care-revision.integration.test.ts`
- `apps/api/test/care-concurrency.integration.test.ts`
- `apps/api/test/audit.integration.test.ts`
- `apps/web/test/care-workspace.test.tsx`
- `scripts/compose-smoke.mjs`
- `README.md`
- `docs/PLAN.md`
- `.agent/current-milestone.json`

---

### Task 1: Common Contracts, Policy, Schema, and Migration

**Files:**
- Modify: `apps/api/src/schema.ts`
- Create: `packages/contracts/src/care/common.ts`
- Create: `packages/contracts/src/care/index.ts`
- Modify: `packages/contracts/src/errors.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/identity.ts`
- Modify: `packages/domain/src/policy.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/contracts/test/care-contracts.test.ts`
- Test: `packages/domain/test/care-policy.test.ts`
- Test: `apps/api/test/m2-migrations.integration.test.ts`
- Generate: `migrations/0001_m2_care_recording.sql` and matching `migrations/meta/*`

**Interfaces:**

```ts
export type CareSource = 'manual' | 'guardian' | 'device' | 'import' | 'ai';
export type CareEventStatus = 'active' | 'voided';
export type CareEventType =
  | 'feeding'
  | 'diaper'
  | 'sleep'
  | 'burping'
  | 'spit_up'
  | 'crying'
  | 'bathing'
  | 'medication'
  | 'temperature'
  | 'weight';

export type CareWarningCode =
  | 'possible_duplicate'
  | 'unusual_value'
  | 'sleep_overlap'
  | 'old_backfill';

export interface CareWarning {
  code: CareWarningCode;
  summary: string;
  recentEventId?: string;
}

export interface CareWriteMetaInput {
  occurredAt: string;
  clientRequestId: string;
  note?: string;
  confirmedWarnings?: CareWarningCode[];
}
```

`ApiErrorCodeSchema` gains:

```ts
'care_confirmation_required'
'care_event_not_found'
'care_state_conflict'
```

`ApiErrorSchema` gains optional strict `details`. For `care_confirmation_required`, the only allowed shape is:

```ts
{ warnings: CareWarning[] }
```

No full care payload is returned inside error details.

Domain capabilities gain `care.read` and `care.write`. `family_admin` continues to allow all capabilities. `caregiver` gains both care capabilities while retaining the existing M1 admin restrictions.

**Database model:**

`care_events`:

```text
id uuid PK
family_id uuid NOT NULL
baby_id uuid NOT NULL
actor_user_id uuid NULL
actor_membership_id uuid NULL
source care_source NOT NULL
event_type care_event_type NOT NULL
occurred_at timestamptz NOT NULL
created_at timestamptz NOT NULL DEFAULT now()
updated_at timestamptz NOT NULL DEFAULT now()
status care_event_status NOT NULL DEFAULT active
version integer NOT NULL DEFAULT 1 CHECK > 0
client_request_id uuid NULL
note text NULL
trace_id text NOT NULL
```

Typed child tables:

```text
feeding_sessions(event_id PK/FK care_events)
feeding_components(id PK, session_event_id FK, component_type, liquid_type, amount_ml, duration_minutes, bottle_capacity_ml, occurred_at)
diaper_events(event_id PK/FK, diaper_kind, stool_color, stool_consistency, stool_amount)
sleep_intervals(event_id PK/FK, started_at, ended_at)
care_actions(event_id PK/FK, feeding_session_event_id NULL FK feeding_sessions, action_type, spit_up_amount, crying_duration_minutes, medication_name, medication_dose, medication_dose_unit)
measurements(event_id PK/FK, measurement_type, value, method)
care_event_revisions(id PK, event_id FK, edit_actor_user_id, edit_actor_membership_id, revision_action, before_json, after_json, trace_id, created_at)
```

DB ownership must not rely only on services:

- add unique `(babies.id, babies.family_id)`;
- add unique `(family_memberships.id, family_memberships.user_id, family_memberships.family_id)`;
- composite FK `care_events(baby_id, family_id) -> babies(id, family_id)`;
- composite FK `care_events(actor_membership_id, actor_user_id, family_id) -> family_memberships(id, user_id, family_id)` for human events;
- partial unique `(family_id, actor_user_id, client_request_id)` when client_request_id is not null.

Add DB checks for positive bottle ml/duration/capacity, component-specific nullable fields, positive measurement/dose, medication name/unit requirement, and sleep `ended_at >= started_at`.

- [ ] **Step 1: Write RED contract and policy tests**

```ts
expect(CareWriteMetaInputSchema.safeParse({
  occurredAt: '2026-08-13T10:00:00.000Z',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  actorUserId: 'forged',
}).success).toBe(false);

expect(can('caregiver', 'care.read')).toBe(true);
expect(can('caregiver', 'care.write')).toBe(true);
expect(can('caregiver', 'family.update')).toBe(false);
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
pnpm --filter @baby-care/domain exec vitest run test/care-policy.test.ts
```

Expected: FAIL because M2 care contracts/capabilities do not exist.

- [ ] **Step 3: Implement contracts, policy, schema; generate migration**

Use the existing Drizzle generator from the API workspace with migration name `m2_care_recording`. Do not hand-edit Drizzle snapshot metadata.

- [ ] **Step 4: Write/run migration integration tests**

Verify:

- clean M1 database migrates to M2;
- negative ml/duration/measurement rejected;
- baby/family mismatch rejected;
- actor/membership/family mismatch rejected;
- same actor/family/clientRequestId cannot duplicate.

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/m2-migrations.integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/schema.ts migrations packages/contracts packages/domain apps/api/test/m2-migrations.integration.test.ts
git commit -m "feat: add M2 care data foundation"
```

---

### Task 2: Deterministic Care Rules

**Files:**
- Create: `packages/domain/src/care/quick-values.ts`
- Create: `packages/domain/src/care/time.ts`
- Create: `packages/domain/src/care/warnings.ts`
- Create: `packages/domain/src/care/index.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/care-rules.test.ts`

**Interfaces:**

```ts
export interface BottleAmountHistory {
  amountMl: number;
  occurredAt: Date;
}

export function rankRecentBottleAmounts(
  records: readonly BottleAmountHistory[],
): number[];

export function validateOccurredAt(
  occurredAt: Date,
  now: Date,
):
  | { ok: true; warning: null | 'old_backfill' }
  | { ok: false; reason: 'future_timestamp' };

export interface DuplicateCandidate {
  eventType: CareEventType;
  occurredAt: Date;
  fingerprint: string;
}

export function findDuplicateWarning(
  candidate: DuplicateCandidate,
  recent: readonly DuplicateCandidate[],
): CareWarning | null;

export function findBottleSanityWarning(
  amountMl: number,
  recentAmounts: readonly number[],
): CareWarning | null;
```

Rules:

- newest 20 records only;
- exact ml grouping;
- frequency desc, tie by newest use desc, max 3;
- <= now + 5min accepted;
- > now + 5min hard invalid;
- older than now - 24h => `old_backfill` soft warning;
- duplicate if exact fingerprint and absolute time difference <=5min;
- fingerprints:
  - bottle `feeding:bottle:<liquidType>:<amountMl>`
  - direct breastfeeding `feeding:direct:<durationMinutes>`
  - diaper `diaper:<kind>`
  - action `action:<kind>`
  - measurement `measurement:<kind>:<canonicalValue>`
- unusual bottle amount: with at least 3 recent positive values, compute median; warn if candidate >= 3x median or <= median / 3; never rewrite.

- [ ] **Step 1: Write RED quick-value tests**

```ts
expect(rankRecentBottleAmounts([
  { amountMl: 60, occurredAt: new Date('2026-08-13T10:00:00Z') },
  { amountMl: 50, occurredAt: new Date('2026-08-13T09:00:00Z') },
  { amountMl: 60, occurredAt: new Date('2026-08-13T08:00:00Z') },
])).toEqual([60, 50]);
```

Also prove only newest 20, top 3 max, exact grouping and recency tie-break.

- [ ] **Step 2: Write RED time/warning tests**

```ts
expect(validateOccurredAt(
  new Date('2026-08-13T10:05:00Z'),
  new Date('2026-08-13T10:00:00Z'),
)).toEqual({ ok: true, warning: null });

expect(validateOccurredAt(
  new Date('2026-08-13T10:05:01Z'),
  new Date('2026-08-13T10:00:00Z'),
)).toEqual({ ok: false, reason: 'future_timestamp' });
```

- [ ] **Step 3: RED -> minimal implementation -> GREEN -> commit**

```bash
pnpm --filter @baby-care/domain exec vitest run test/care-rules.test.ts
git add packages/domain/src/care packages/domain/src/index.ts packages/domain/test/care-rules.test.ts
git commit -m "feat: add deterministic M2 care rules"
```

---

### Task 3: Authenticated Ownership, Idempotency, and Revision Primitives

**Files:**
- Create: `apps/api/src/care/care-errors.ts`
- Create: `apps/api/src/care/care-auth.ts`
- Create: `apps/api/src/care/care-event-repository.ts`
- Test: `apps/api/test/care-event.integration.test.ts`

**Interfaces:**

```ts
export interface CareActorContext extends AuthContext {
  babyId: string;
}

export async function createCareEvent(client, input): Promise<CareEventRow>;
export async function findByClientRequestId(client, context, clientRequestId): Promise<CareEventRow | null>;
export async function loadActiveCareEventForUpdate(client, context, eventId): Promise<CareEventRow | null>;
export async function appendCareRevision(client, input): Promise<void>;
export async function voidCareEvent(client, input): Promise<void>;
```

`care-auth.ts` reuses existing `AuthService`, gets `babyId` from the authenticated Session DTO, checks `care.read` / `care.write`, and applies the existing Origin guard to unsafe methods.

- [ ] **Step 1: Write RED integration tests**

Register a test-only Fastify route through `care-auth.ts` and prove Dad/Mom/Nanny derive the correct actor/family/baby ids. Disable Nanny membership and prove the same cookie no longer authorizes a care write. Test idempotent repository creation in a transaction.

- [ ] **Step 2: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-event.integration.test.ts
```

- [ ] **Step 3: Implement GREEN and commit**

Care audit metadata includes care action name, event id/type, actor/source/trace only. Do not copy private notes, medication, measurement or feeding values into audit metadata.

```bash
git add apps/api/src/care apps/api/test/care-event.integration.test.ts
git commit -m "feat: add authenticated care event foundation"
```

---

### Task 4: Mixed Feeding Sessions and Dynamic Quick Values

**Files:**
- Create: `packages/contracts/src/care/feeding.ts`
- Modify: `packages/contracts/src/care/index.ts`
- Create: `apps/api/src/care/feeding-service.ts`
- Create: `apps/api/src/routes/care-feeding.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/feeding.integration.test.ts`

**Routes:**

```text
POST /api/care/feeding-sessions
GET  /api/care/feeding/quick-values?liquidType=expressed_breast_milk|formula
```

**Interfaces:**

```ts
export type FeedingComponentInput =
  | { kind: 'direct_breastfeeding'; durationMinutes: number }
  | {
      kind: 'bottle';
      liquidType: 'expressed_breast_milk' | 'formula';
      amountMl: number;
      bottleCapacityMl?: number;
    };

export type FeedingRelatedActionInput =
  | { kind: 'burping' }
  | { kind: 'spit_up'; amount: 'small' | 'medium' | 'large' };

export type CreateFeedingSessionInput = CareWriteMetaInput & {
  components: FeedingComponentInput[];
  relatedActions?: FeedingRelatedActionInput[];
};
```

Unconfirmed warnings return HTTP 409:

```json
{
  "code": "care_confirmation_required",
  "message": "Confirmation is required.",
  "traceId": "...",
  "details": { "warnings": [{ "code": "unusual_value", "summary": "..." }] }
}
```

No row is written before confirmation. Resubmit unchanged input with returned warning codes in `confirmedWarnings`.

- [ ] **Step 1: RED integration tests**

Cover:

- formula 60ml persists exactly 60ml;
- 150ml bottle capacity persists as metadata but does not change intake;
- direct breastfeeding 18min has no ml;
- one feeding session can contain direct + bottle components;
- related burp/spit-up create linked action events;
- formula and expressed histories are separate;
- quick values obey recent-20/top-3 rule;
- repeated 60ml history + 600ml => `unusual_value` and no write;
- same fingerprint inside 5min => `possible_duplicate` and no write until explicit confirmation;
- repeated client request id returns existing result.

- [ ] **Step 2: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/feeding.integration.test.ts
```

- [ ] **Step 3: Implement transactionally and GREEN**

One DB transaction creates event/session/components/linked action events/audits. Quick-values query only active bottle components of the requested liquid type.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/care apps/api/src/care/feeding-service.ts apps/api/src/routes/care-feeding.ts apps/api/src/app.ts apps/api/test/feeding.integration.test.ts
git commit -m "feat: add mixed feeding sessions"
```

---

### Task 5: Diaper/Stool and Sleep Recording

**Files:**
- Create: `packages/contracts/src/care/diaper.ts`
- Create: `packages/contracts/src/care/sleep.ts`
- Modify: `packages/contracts/src/care/index.ts`
- Create: `apps/api/src/care/diaper-service.ts`
- Create: `apps/api/src/care/sleep-service.ts`
- Create: `apps/api/src/routes/care-diaper.ts`
- Create: `apps/api/src/routes/care-sleep.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/diaper-sleep.integration.test.ts`

**Routes:**

```text
POST /api/care/diapers
POST /api/care/sleep/start
POST /api/care/sleep/wake
```

```ts
export type CreateDiaperInput = CareWriteMetaInput & {
  kind: 'urine' | 'stool' | 'urine_stool';
  stoolColor?: string;
  stoolConsistency?: string;
  stoolAmount?: string;
};
```

Stool details are optional. Urine-only save must not require any stool detail.

- [ ] **Step 1: RED tests**

Cover urine-only, stool detail persistence, duplicate warning, +5min valid, >+5min invalid, >24h `old_backfill`, wake before start rejected, and second open sleep returning `sleep_overlap` rather than silently closing another interval.

- [ ] **Step 2: RED -> GREEN -> commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/diaper-sleep.integration.test.ts
git add packages/contracts/src/care apps/api/src/care/diaper-service.ts apps/api/src/care/sleep-service.ts apps/api/src/routes/care-diaper.ts apps/api/src/routes/care-sleep.ts apps/api/src/app.ts apps/api/test/diaper-sleep.integration.test.ts
git commit -m "feat: add diaper and sleep recording"
```

---

### Task 6: Frequent Care Actions and Measurements

**Files:**
- Create: `packages/contracts/src/care/actions.ts`
- Create: `packages/contracts/src/care/measurements.ts`
- Modify: `packages/contracts/src/care/index.ts`
- Create: `apps/api/src/care/action-service.ts`
- Create: `apps/api/src/care/measurement-service.ts`
- Create: `apps/api/src/routes/care-actions.ts`
- Create: `apps/api/src/routes/care-measurements.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/care-actions.integration.test.ts`

**Routes:**

```text
POST /api/care/actions
POST /api/care/measurements
```

**Interfaces:**

```ts
export type CareActionPayload =
  | { kind: 'burping' }
  | { kind: 'spit_up'; amount: 'small' | 'medium' | 'large' }
  | { kind: 'crying'; durationMinutes?: number }
  | { kind: 'bathing' }
  | { kind: 'medication'; medicationName: string; dose: number; doseUnit: string };

export type CreateCareActionInput = CareWriteMetaInput & {
  action: CareActionPayload;
};

export type MeasurementPayload =
  | { kind: 'temperature'; valueCelsius: number; method?: string }
  | { kind: 'weight'; valueKg: number };

export type CreateMeasurementInput = CareWriteMetaInput & {
  measurement: MeasurementPayload;
};

export type CareActionEditPayload = CareActionPayload;
export type MeasurementEditPayload = MeasurementPayload;
```

- [ ] **Step 1: RED tests**

Verify all action/measurement families persist with authenticated actor/source; positive canonical values; duplicate fingerprints; no medication recommendation/calculation fields or endpoints; audit/diagnostics do not expose medication, temperature, weight or note values.

- [ ] **Step 2: RED -> GREEN -> commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-actions.integration.test.ts
git add packages/contracts/src/care apps/api/src/care apps/api/src/routes apps/api/src/app.ts apps/api/test/care-actions.integration.test.ts
git commit -m "feat: add frequent care actions and measurements"
```

---

### Task 7: Rolling Summary, Timeline, Edit, and Undo

**Files:**
- Create: `packages/contracts/src/care/query.ts`
- Create: `packages/contracts/src/care/revisions.ts`
- Modify: `packages/contracts/src/care/index.ts`
- Create: `apps/api/src/care/query-service.ts`
- Create: `apps/api/src/care/revision-service.ts`
- Create: `apps/api/src/routes/care-query.ts`
- Create: `apps/api/src/routes/care-revisions.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/care-query.integration.test.ts`
- Test: `apps/api/test/care-revision.integration.test.ts`

**Routes:**

```text
GET  /api/care/summary?at=<ISO>
GET  /api/care/timeline?before=<ISO>&limit=<1..50>
PATCH /api/care/events/:eventId
POST /api/care/events/:eventId/undo
```

**Summary DTO:**

```ts
export interface CareHomeSummaryDto {
  asOf: string;
  lastFeeding: null | {
    occurredAt: string;
    bottle?: {
      liquidType: 'expressed_breast_milk' | 'formula';
      amountMl: number;
    };
    directBreastfeedingMinutes?: number;
  };
  lastDiaper: null | {
    occurredAt: string;
    kind: 'urine' | 'stool' | 'urine_stool';
  };
  rolling24h: {
    bottleTotalMl: number;
    expressedBreastMilkMl: number;
    formulaMl: number;
    directBreastfeedingSessions: number;
    directBreastfeedingMinutes: number;
  };
  currentSleep: null | {
    intervalId: string;
    startedAt: string;
  };
}
```

24h predicate is inclusive: `occurred_at >= asOf - interval '24 hours' AND occurred_at <= asOf`, active rows only. Timeline order: `occurred_at DESC, created_at DESC`.

**Edit union:**

```ts
export type EditCareEventInput =
  | {
      eventType: 'feeding';
      occurredAt: string;
      note?: string;
      components: FeedingComponentInput[];
      relatedActions?: FeedingRelatedActionInput[];
    }
  | {
      eventType: 'diaper';
      occurredAt: string;
      note?: string;
      kind: 'urine' | 'stool' | 'urine_stool';
      stoolColor?: string;
      stoolConsistency?: string;
      stoolAmount?: string;
    }
  | {
      eventType: 'sleep';
      startedAt: string;
      endedAt?: string | null;
      note?: string;
    }
  | {
      eventType: 'burping' | 'spit_up' | 'crying' | 'bathing' | 'medication';
      occurredAt: string;
      note?: string;
      action: CareActionEditPayload;
    }
  | {
      eventType: 'temperature' | 'weight';
      occurredAt: string;
      note?: string;
      measurement: MeasurementEditPayload;
    };
```

Server rejects discriminator mismatch with stored event type.

Feeding related-action semantics are explicit:

- `care_actions.feeding_session_event_id` links related burp/spit-up records;
- editing a feeding session transactionally reconciles the component rows and linked action events;
- undoing a feeding session marks the feeding event **and every linked action event created by that session** `voided` in the same transaction;
- each affected event receives revision/audit evidence;
- no physical DELETE is used for user correction.

- [ ] **Step 1: RED query tests**

Assert exact 24h boundary, capacity exclusion, formula/expressed subtotals, breastfeeding count/minutes/no ml, voided exclusion, last feed/diaper, open-sleep state.

- [ ] **Step 2: RED revision tests**

Editing keeps original actor/source, increments version, records edit actor and private before/after snapshot. Undo voids, never deletes, and removes event from active summary/timeline/quick-values. Include feeding-linked action cascade test.

- [ ] **Step 3: RED -> GREEN -> commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-query.integration.test.ts test/care-revision.integration.test.ts
git add packages/contracts/src/care apps/api/src/care/query-service.ts apps/api/src/care/revision-service.ts apps/api/src/routes/care-query.ts apps/api/src/routes/care-revisions.ts apps/api/src/app.ts apps/api/test/care-query.integration.test.ts apps/api/test/care-revision.integration.test.ts
git commit -m "feat: add care summary timeline and corrections"
```

---

### Task 8: Fast Web/PWA Care Workspace

**Files:**
- Create: `apps/web/src/care/CareWorkspace.tsx`
- Create: `apps/web/src/care/CareSummary.tsx`
- Create: `apps/web/src/care/QuickRecordBar.tsx`
- Create: `apps/web/src/care/FeedingForm.tsx`
- Create: `apps/web/src/care/DiaperForm.tsx`
- Create: `apps/web/src/care/SleepControls.tsx`
- Create: `apps/web/src/care/useCareWorkspace.ts`
- Modify: `apps/web/src/api-client.ts`
- Modify: `apps/web/src/auth/AuthenticatedShell.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/app.css`
- Test: `apps/web/test/care-workspace.test.tsx`

- [ ] **Step 1: RED Web tests**

Assert:

- home summary shows last feed, last diaper, rolling 24h bottle total, current sleep when present;
- feeding choices are expressed milk / formula / direct breastfeeding;
- 90/150/200 never appear as actual-intake quick buttons;
- quick-values response `[45,60,75]` renders exactly those plus `其他`;
- direct breastfeeding asks only total minutes;
- urine diaper is a short path; stool progressively reveals optional details;
- sleep buttons include `现在`, `10分钟前`, `20分钟前`, `30分钟前`, `自定义`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-workspace.test.tsx
```

- [ ] **Step 3: Implement GREEN**

Disable only the active submit while saving. Reuse the same `clientRequestId` on a deliberate retry. Preserve current form fields after save failure. Dad/Mom/Nanny share care tools while existing M1 admin restrictions remain.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/care apps/web/src/api-client.ts apps/web/src/auth/AuthenticatedShell.tsx apps/web/src/App.tsx apps/web/src/app.css apps/web/test/care-workspace.test.tsx
git commit -m "feat: add M2 fast care recording workspace"
```

---

### Task 9: Web Frequent Events, Warnings, Recent Edit/Undo

**Files:**
- Create: `apps/web/src/care/OtherCareForm.tsx`
- Create: `apps/web/src/care/RecentRecordCard.tsx`
- Create: `apps/web/src/care/CareWarningDialog.tsx`
- Modify: `apps/web/src/care/CareWorkspace.tsx`
- Modify: `apps/web/src/care/useCareWorkspace.ts`
- Test: `apps/web/test/care-workspace.test.tsx`

- [ ] **Step 1: RED tests**

Cover burping, spit-up, crying, bathing, temperature, weight, medication facts, duplicate/unusual/old-backfill/sleep-overlap confirmations, save failure retaining entered fields, and recent record `修改` / `撤销` actions.

- [ ] **Step 2: Implement warning flow**

`继续记录` resubmits the unchanged input with the warning code appended to `confirmedWarnings`. Never normalize values or merge facts silently.

- [ ] **Step 3: GREEN and commit**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-workspace.test.tsx
git add apps/web/src/care apps/web/test/care-workspace.test.tsx
git commit -m "feat: add care warnings corrections and frequent events"
```

---

### Task 10: Concurrent Caregiver and Privacy Integration Gate

**Files:**
- Modify: `apps/api/test/care-event.integration.test.ts`
- Modify: `apps/api/test/care-revision.integration.test.ts`
- Create: `apps/api/test/care-concurrency.integration.test.ts`
- Modify: `apps/api/test/audit.integration.test.ts`

- [ ] **Step 1: RED concurrency/privacy tests**

Dad and Nanny write concurrently. Assert distinct actor/membership ids, same family/baby, `source='manual'`, no lost rows, no ownership forgery, disabled membership rejection.

Assert audit/compact diagnostics do not contain medication name/dose, temperature, weight, note body, cookie, raw session token, or setup token.

- [ ] **Step 2: Run focused integration**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-event.integration.test.ts test/care-revision.integration.test.ts test/care-concurrency.integration.test.ts test/audit.integration.test.ts
```

- [ ] **Step 3: Fix only proven defects, GREEN, commit**

```bash
git add apps/api/src/care apps/api/test
git commit -m "test: harden M2 caregiver attribution and privacy"
```

---

### Task 11: Production Compose E2E and Exact-Head Release Gate

**Files:**
- Modify: `scripts/compose-smoke.mjs`
- Modify: `README.md`
- Modify: `docs/PLAN.md`
- Modify: `.agent/current-milestone.json`
- Modify only for proven production defects: `compose.yaml`, `infra/docker/*`, `.github/workflows/ci.yml`

- [ ] **Step 1: Extend the existing M1 production smoke**

Keep all M1 empty-DB/setup/session/authorization assertions, then through the production container/Web/API route path run:

```text
Dad login
-> formula feeding session: actual 60ml, bottle capacity 150ml
-> separate direct breastfeeding session: 18min
-> urine+stool diaper with detail
-> sleep start 20 minutes ago
-> summary: bottleTotal=60, breastfeedingSessions=1, breastfeedingMinutes=18
-> edit bottle session 60 -> 65
-> summary: bottleTotal=65
-> undo bottle session
-> summary: bottleTotal=0, breastfeedingMinutes=18
-> Nanny login
-> Nanny creates a care event
-> timeline proves Nanny actor attribution
```

This must prove bottle capacity 150 never appears in the intake total.

- [ ] **Step 2: Run focused empty-DB Compose smoke**

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down -v --remove-orphans
```

- [ ] **Step 3: Update status/docs before final CI**

Only after Tasks 1-10 and focused Compose are green:

- `docs/PLAN.md`: mark M2 complete and state M3 is next; do not mark M3/Guardian complete.
- `.agent/current-milestone.json`: record M2 implementation branch, design source, verified M1 baseline, completion state, and next milestone.
- `README.md`: describe only care flows that are actually operational.

If any status/doc change occurs after final CI, final CI must be re-run.

- [ ] **Step 4: Pre-final scope review**

Search the final diff and confirm:

```text
left/right breastfeeding timers = absent
90/150/200 intake shortcut defaults = absent
fixed Nanny shift = absent
Guardian/JoyAI/Qwen implementation = absent
medication recommendation = absent
client-supplied actor/family/baby ownership = absent
DELETE-based undo = absent
full private care payload diagnostics = absent
unresolved M2 production TODO/TBD = absent
main modifications = absent
```

- [ ] **Step 5: Exact-final-head CI**

Require one exact final commit SHA containing code, migration, Web, Compose smoke, README, `docs/PLAN.md`, and `.agent/current-milestone.json`, with fresh:

```text
static                   PASS
unit/contracts           PASS
PostgreSQL integration   PASS
production build         PASS
production Compose smoke PASS
```

- [ ] **Step 6: Verification and Draft PR**

Invoke `superpowers:verification-before-completion`, review the final diff against the unchanged approved M2 spec, then create/update an M2 Draft PR with base `codex/m1-family-baby-foundation`. Do not merge `main`.
