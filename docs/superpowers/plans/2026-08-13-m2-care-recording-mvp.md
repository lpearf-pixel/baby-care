# M2 Care Recording MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved M2 newborn care recorder for `xiangxiang`, including mixed feeding, diaper/stool, sleep backfill, frequent care events, measurements, correction/undo, duplicate/sanity warnings, rolling 24-hour queries, and a 2-3 tap Web/PWA recording flow.

**Architecture:** Start from the verified M1 production baseline `codex/m1-family-baby-foundation @ 76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`. Add a normalized `care_events` envelope plus typed PostgreSQL tables for feeding, diaper, sleep, actions, and measurements. Keep deterministic rules in `packages/domain`, validation/DTOs in `packages/contracts`, authenticated persistence and queries in focused API modules, and compact recording components in `apps/web/src/care/`.

**Tech Stack:** Node 24+, TypeScript, pnpm 10.17.1, Fastify, PostgreSQL 16, Drizzle ORM/Kit, Zod, React/Vite PWA, Vitest, Testing Library, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Approved source design: `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md` copied unchanged from `codex/m2-care-recording-mvp @ eadb8f1d41770b5ef940f16993e57a4cb8ee6bc5`.
- The M1-H prerequisite in section 21 of the design is now satisfied by authoritative M1 HEAD `76d578a464ec2ab1f8eb1f8f33d8e429caff10ba` and CI run `31707486985` (5/5 PASS); do not re-open or redesign it.
- Do not modify or merge `main`.
- Bottle capacities 90/150/200 ml are container metadata only; they are never default intake shortcuts and never contribute to intake totals.
- Bottle feeding distinguishes `expressed_breast_milk` and `formula`.
- Direct breastfeeding records total session duration only; never infer ml.
- Dynamic bottle shortcuts are per liquid type: most recent 20 active bottle components, exact-ml frequency descending, tie by most recent use descending, top 3.
- Sleep offers now / 10 / 20 / 30 minutes ago / custom; timestamps more than 5 minutes in the future are structurally invalid.
- Nanny handoff schedule remains unset; do not hard-code a shift window.
- Medication records facts only; no dose calculation, prescription, or recommendation.
- Normal manual writes derive `familyId`, `babyId`, `actorUserId`, `actorMembershipId`, and `source=manual` from authenticated server context.
- Care warnings never silently merge, rewrite, or delete facts. User confirmation is explicit.
- Every write supports idempotency via a client-generated UUID request id to prevent repeated-tap duplicates.
- Full offline synchronization, Guardian, JoyAI, Qwen, automated feeding recognition, M3 handoff UX, and advanced trend dashboards are out of scope.
- Use focused RED -> GREEN tests for each task; run the full static/unit/integration/build/compose gate only at task boundaries that materially change cross-module behavior and at final release.

---

## File Map

### Shared contracts

Create:

- `packages/contracts/src/care/common.ts` — care event/warning/common write contracts.
- `packages/contracts/src/care/feeding.ts` — feeding session/component inputs and DTOs.
- `packages/contracts/src/care/diaper.ts` — diaper/stool inputs and DTOs.
- `packages/contracts/src/care/sleep.ts` — sleep start/wake/edit DTOs.
- `packages/contracts/src/care/actions.ts` — burping/spit-up/crying/bathing/medication DTOs.
- `packages/contracts/src/care/measurements.ts` — temperature/weight DTOs.
- `packages/contracts/src/care/query.ts` — home summary, timeline, quick-values DTOs.
- `packages/contracts/src/care/revisions.ts` — edit/undo contracts.
- `packages/contracts/src/care/index.ts` — exports.

Modify:

- `packages/contracts/src/errors.ts` — add `care_confirmation_required`, `care_event_not_found`, `care_state_conflict`; allow privacy-safe warning details.
- `packages/contracts/src/index.ts` — export M2 care contracts.

### Domain rules

Create:

- `packages/domain/src/care/quick-values.ts` — recent-20 deterministic bottle ranking.
- `packages/domain/src/care/time.ts` — future-skew validation and backfill helper.
- `packages/domain/src/care/warnings.ts` — duplicate and unusual-value rules.
- `packages/domain/src/care/index.ts` — exports.

Modify:

- `packages/domain/src/identity.ts` — add `care.read` and `care.write` capabilities.
- `packages/domain/src/policy.ts` — caregivers receive normal care read/write, while family admin behavior stays unchanged.
- `packages/domain/src/index.ts` — export care rules.

### API persistence/services/routes

Create:

- `apps/api/src/care/care-event-repository.ts` — event envelope, idempotency lookup, revision/void primitives.
- `apps/api/src/care/care-errors.ts` — typed care errors/warnings for route mapping.
- `apps/api/src/care/care-auth.ts` — care-specific authenticated context + origin/capability guard using existing AuthService.
- `apps/api/src/care/feeding-service.ts`.
- `apps/api/src/care/diaper-service.ts`.
- `apps/api/src/care/sleep-service.ts`.
- `apps/api/src/care/action-service.ts`.
- `apps/api/src/care/measurement-service.ts`.
- `apps/api/src/care/revision-service.ts`.
- `apps/api/src/care/query-service.ts`.
- `apps/api/src/routes/care-feeding.ts`.
- `apps/api/src/routes/care-diaper.ts`.
- `apps/api/src/routes/care-sleep.ts`.
- `apps/api/src/routes/care-actions.ts`.
- `apps/api/src/routes/care-measurements.ts`.
- `apps/api/src/routes/care-revisions.ts`.
- `apps/api/src/routes/care-query.ts`.

Modify:

- `apps/api/src/schema.ts` — M2 enums/tables/indexes/check constraints.
- `apps/api/src/app.ts` — instantiate/register care modules only when the authenticated M1 database runtime is present.
- `migrations/` and `migrations/meta/` — generated M2 migration/snapshot.

### Web/PWA

Create:

- `apps/web/src/care/CareWorkspace.tsx` — authenticated M2 container.
- `apps/web/src/care/CareSummary.tsx` — last feed/diaper, rolling 24h, current sleep.
- `apps/web/src/care/QuickRecordBar.tsx` — primary 2-3 tap action chooser.
- `apps/web/src/care/FeedingForm.tsx`.
- `apps/web/src/care/DiaperForm.tsx`.
- `apps/web/src/care/SleepControls.tsx`.
- `apps/web/src/care/OtherCareForm.tsx`.
- `apps/web/src/care/RecentRecordCard.tsx` — edit/undo after save.
- `apps/web/src/care/CareWarningDialog.tsx` — explicit duplicate/unusual/overlap confirmation.
- `apps/web/src/care/useCareWorkspace.ts` — load/refresh/submit state and preserve unsaved forms on failure.

Modify:

- `apps/web/src/api-client.ts` — typed care endpoints and warning details.
- `apps/web/src/auth/AuthenticatedShell.tsx` — render CareWorkspace for Dad/Mom/Nanny while retaining M1 family/admin section.
- `apps/web/src/App.tsx` — remove obsolete “care recording comes later” copy.
- `apps/web/src/app.css` — responsive/night-friendly care controls without changing global framework.

### Tests / release

Create focused tests under:

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
- `apps/web/test/care-workspace.test.tsx`

Modify:

- `scripts/compose-smoke.mjs` — extend verified M1 family flow with M2 care release flow.
- `docs/PLAN.md` and `.agent/current-milestone.json` — final status before final exact-head CI.
- `README.md` — only after M2 is operational.

---

### Task 1: Care Foundation Schema, Common Contracts, and Authorization

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
- Generate: `migrations/0001_m2_care_recording.sql` plus matching `migrations/meta/*`

**Interfaces:**
- Produces `CareEventType`, `CareEventStatus`, `CareSource`, `CareWarningCode`, `CareWarning`, `CareWriteMetaInput`.
- `CareWriteMetaInput` contains `occurredAt`, `clientRequestId`, `confirmedWarnings?`, and optional `note`; it never contains actor/family/baby/source ids.
- Adds domain capabilities `care.read` and `care.write`; both `family_admin` and `caregiver` receive them.

- [ ] **Step 1: Write RED common-contract and policy tests**

```ts
expect(CareWriteMetaInputSchema.parse({
  occurredAt: '2026-08-13T08:00:00.000Z',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
})).toMatchObject({ clientRequestId: expect.any(String) });

expect(can('caregiver', 'care.read')).toBe(true);
expect(can('caregiver', 'care.write')).toBe(true);
expect(can('caregiver', 'family.update')).toBe(false);
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
pnpm --filter @baby-care/domain exec vitest run test/care-policy.test.ts
```

Expected: FAIL because M2 care contracts/capabilities do not exist.

- [ ] **Step 3: Add M2 schema definitions**

Add enums/tables in `apps/api/src/schema.ts`:

```ts
care_source: manual | guardian | device | import | ai
care_event_status: active | voided
care_event_type: feeding | diaper | sleep | burping | spit_up | crying | bathing | medication | temperature | weight

care_events:
  id uuid pk
  family_id fk families
  baby_id fk babies
  actor_user_id fk users nullable for future non-human sources
  actor_membership_id fk family_memberships nullable
  source care_source not null
  event_type care_event_type not null
  occurred_at timestamptz not null
  created_at timestamptz not null default now
  updated_at timestamptz not null default now
  status care_event_status not null default active
  version integer not null default 1 check > 0
  client_request_id uuid
  note text
  trace_id text not null
```

Add a unique index on `(family_id, actor_user_id, client_request_id)` for non-null client request ids, plus family/baby/occurred_at indexes. Create typed tables required by later tasks now so one M2 migration defines the stable data model:

- `feeding_sessions(event_id pk/fk care_events)`
- `feeding_components(id, session_event_id, component_type, liquid_type, amount_ml, duration_minutes, bottle_capacity_ml, occurred_at)`
- `diaper_events(event_id pk/fk, diaper_kind, stool_color, stool_consistency, stool_amount)`
- `sleep_intervals(event_id pk/fk, started_at, ended_at)`
- `care_actions(event_id pk/fk, action_type, spit_up_amount, crying_duration_minutes, medication_name, medication_dose, medication_dose_unit)`
- `measurements(event_id pk/fk, measurement_type, value, method)`
- `care_event_revisions(id, event_id, edit_actor_user_id, edit_actor_membership_id, revision_action, before_json, after_json, trace_id, created_at)`

Use DB check constraints for positive bottle ml/durations/capacity, ended_at >= started_at, positive measurement/dose values, and action-specific required fields for medication.

- [ ] **Step 4: Generate the migration and write migration RED/constraint tests**

Run the repository's Drizzle generator from the API workspace with migration name `m2_care_recording`. Assert a clean database migrates from M1 to M2 and DB constraints reject negative ml/durations and foreign-family ownership.

Run:

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/m2-migrations.integration.test.ts
```

Expected after implementation: PASS.

- [ ] **Step 5: Run focused GREEN tests and commit**

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
pnpm --filter @baby-care/domain exec vitest run test/care-policy.test.ts
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/m2-migrations.integration.test.ts
git add apps/api/src/schema.ts migrations packages/contracts packages/domain apps/api/test/m2-migrations.integration.test.ts
git commit -m "feat: add M2 care data foundation"
```

---

### Task 2: Deterministic Quick Values, Time Validation, Duplicate and Sanity Rules

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
export function rankRecentBottleAmounts(records: readonly BottleAmountHistory[]): number[];

export function validateOccurredAt(occurredAt: Date, now: Date):
  | { ok: true; oldBackfill: boolean }
  | { ok: false; reason: 'future_timestamp' };

export interface DuplicateCandidate {
  eventType: string;
  occurredAt: Date;
  fingerprint: string;
}
export function findDuplicateWarning(candidate: DuplicateCandidate, recent: readonly DuplicateCandidate[]): CareWarning | null;
export function findBottleSanityWarning(amountMl: number, recentAmounts: readonly number[]): CareWarning | null;
```

- [ ] **Step 1: Write RED quick-value tests**

Cover exactly: only the first 20 recent rows are considered; exact amounts are grouped; frequency wins; ties use most-recent occurrence; output is unique and max 3; expressed milk/formula separation is handled by the caller providing the relevant history.

```ts
expect(rankRecentBottleAmounts([
  { amountMl: 60, occurredAt: new Date('2026-08-13T10:00:00Z') },
  { amountMl: 50, occurredAt: new Date('2026-08-13T09:00:00Z') },
  { amountMl: 60, occurredAt: new Date('2026-08-13T08:00:00Z') },
])).toEqual([60, 50]);
```

- [ ] **Step 2: Write RED time/warning tests**

```ts
expect(validateOccurredAt(new Date('2026-08-13T10:05:00Z'), new Date('2026-08-13T10:00:00Z'))).toEqual({ ok: true, oldBackfill: false });
expect(validateOccurredAt(new Date('2026-08-13T10:05:01Z'), new Date('2026-08-13T10:00:00Z'))).toEqual({ ok: false, reason: 'future_timestamp' });
```

Duplicate rule: same care type + same fingerprint within 5 minutes => `possible_duplicate`; otherwise no warning. Bottle sanity rule: with at least 3 historical values, warn when a positive candidate is >= 3x the median or <= one-third of the median; never rewrite the number.

- [ ] **Step 3: Run RED, implement, run GREEN, commit**

```bash
pnpm --filter @baby-care/domain exec vitest run test/care-rules.test.ts
git add packages/domain/src/care packages/domain/src/index.ts packages/domain/test/care-rules.test.ts
git commit -m "feat: add deterministic M2 care rules"
```

---

### Task 3: Authenticated Care Event, Idempotency, and Revision Foundation

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

`care-auth.ts` authenticates through the existing `AuthService`, derives `babyId` from the current M1 session, enforces `care.read` / `care.write`, and validates Origin on unsafe requests using the existing M1 origin rule. It must never accept actor/family/baby ids from a care request body.

- [ ] **Step 1: Write RED integration tests**

Verify Dad, Mom, and Nanny can create a generic test care envelope only through authenticated context; a forged body field such as `familyId` or `actorUserId` is rejected by strict Zod contracts; disabled membership fails authentication; same `clientRequestId` returns the original event rather than creating a second row.

- [ ] **Step 2: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-event.integration.test.ts
```

- [ ] **Step 3: Implement repository/guard primitives and GREEN**

Use a transaction for event creation and later type-specific row creation. Keep audit metadata compact: action, event id/type, not full care payload.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/care apps/api/test/care-event.integration.test.ts
git commit -m "feat: add authenticated care event foundation"
```

---

### Task 4: Mixed Feeding Session API and Dynamic Bottle Shortcuts

**Files:**
- Create: `packages/contracts/src/care/feeding.ts`
- Modify: `packages/contracts/src/care/index.ts`
- Create: `apps/api/src/care/feeding-service.ts`
- Create: `apps/api/src/routes/care-feeding.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/feeding.integration.test.ts`

**Interfaces:**

```ts
CreateFeedingSessionInput = {
  occurredAt: string;
  clientRequestId: string;
  note?: string;
  confirmedWarnings?: CareWarningCode[];
  components: Array<
    | { kind: 'direct_breastfeeding'; durationMinutes: number }
    | { kind: 'bottle'; liquidType: 'expressed_breast_milk' | 'formula'; amountMl: number; bottleCapacityMl?: number }
  >;
  relatedActions?: Array<
    | { kind: 'burping' }
    | { kind: 'spit_up'; amount: 'small' | 'medium' | 'large' }
  >;
};
```

Routes:

- `POST /api/care/feeding-sessions`
- `GET /api/care/feeding/quick-values?liquidType=expressed_breast_milk|formula`

If unconfirmed warnings exist, return HTTP 409 with `code='care_confirmation_required'` and privacy-safe `details.warnings`; no row is written. Resubmitting with the warning code in `confirmedWarnings` writes the exact user-entered value.

- [ ] **Step 1: Write RED contract/integration tests**

Cover:

- formula 60ml persists actual amount.
- bottle capacity 150ml is stored but does not alter actual amount.
- direct breastfeeding 18min persists duration and no ml.
- one session may contain direct breastfeeding + formula + burping + spit-up.
- formula and expressed-milk quick histories are separate.
- recent-20 top-3 algorithm is returned by the API.
- 600ml against repeated 60ml history yields an `unusual_value` confirmation warning and does not auto-correct.
- a same-type/same-value event within 5 minutes yields `possible_duplicate` and can be explicitly continued.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/feeding.integration.test.ts
```

- [ ] **Step 3: Implement minimal feeding service and routes**

Within one DB transaction create the session event, feeding session row, components, related action events, compact audit rows, then commit. On idempotent retry return the existing session DTO.

- [ ] **Step 4: Run GREEN and commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/feeding.integration.test.ts
git add packages/contracts/src/care apps/api/src/care/feeding-service.ts apps/api/src/routes/care-feeding.ts apps/api/src/app.ts apps/api/test/feeding.integration.test.ts
git commit -m "feat: add mixed feeding sessions"
```

---

### Task 5: Diaper/Stool and Sleep APIs

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

**Interfaces:**

Diaper:

```ts
{ kind: 'urine' | 'stool' | 'urine_stool'; stoolColor?: string; stoolConsistency?: string; stoolAmount?: string; occurredAt; clientRequestId; note?; confirmedWarnings? }
```

Sleep routes:

- `POST /api/care/sleep/start` with explicit `occurredAt`.
- `POST /api/care/sleep/wake` with explicit `occurredAt` and the currently open interval id if the client has it; server verifies it belongs to this family/baby.

- [ ] **Step 1: Write RED tests**

Cover urine-only minimal save, optional stool details, no forced stool fields, now/10/20/30/custom as ordinary timestamps, exactly +5min future accepted, >+5min rejected, wake before start rejected, second open sleep creates `sleep_overlap` confirmation warning rather than silently closing the first interval.

- [ ] **Step 2: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/diaper-sleep.integration.test.ts
```

- [ ] **Step 3: Implement GREEN services/routes**

Sleep state changes are transactional and append revision records when an existing interval is corrected. Duplicate diaper warnings use kind + 5-minute fingerprint.

- [ ] **Step 4: Commit**

```bash
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

**Interfaces:**

Action union:

```ts
burping: { kind:'burping', occurredAt, note? }
spit_up: { kind:'spit_up', amount:'small'|'medium'|'large', occurredAt, note? }
crying: { kind:'crying', durationMinutes?: positive integer, occurredAt, note? }
bathing: { kind:'bathing', occurredAt, note? }
medication: { kind:'medication', medicationName, dose: positive number, doseUnit, occurredAt, note? }
```

Measurements:

```ts
temperature: { kind:'temperature', valueCelsius: positive number, method?: string, occurredAt, note? }
weight: { kind:'weight', valueKg: positive number, occurredAt, note? }
```

- [ ] **Step 1: Write RED tests**

Verify all seven frequent event families persist with authenticated actor/source; medication contract contains no recommendation/calculation field or endpoint; negative dose/temp/weight is structurally rejected; compact audit/diagnostics do not contain medication names/doses or full notes.

- [ ] **Step 2: Run RED, implement, GREEN, commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-actions.integration.test.ts
git add packages/contracts/src/care apps/api/src/care apps/api/src/routes apps/api/src/app.ts apps/api/test/care-actions.integration.test.ts
git commit -m "feat: add frequent care actions and measurements"
```

---

### Task 7: Timeline, Rolling 24-Hour Summary, Current State, and Revisions

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

**Interfaces:**

Routes:

- `GET /api/care/summary?at=<ISO>`
- `GET /api/care/timeline?before=<ISO>&limit=<1..50>`
- `PATCH /api/care/events/:eventId`
- `POST /api/care/events/:eventId/undo`

Summary DTO:

```ts
{
  asOf: string;
  lastFeeding: null | { occurredAt: string; bottle?: { liquidType; amountMl }; directBreastfeedingMinutes?: number };
  lastDiaper: null | { occurredAt: string; kind: 'urine'|'stool'|'urine_stool' };
  rolling24h: {
    bottleTotalMl: number;
    expressedBreastMilkMl: number;
    formulaMl: number;
    directBreastfeedingSessions: number;
    directBreastfeedingMinutes: number;
  };
  currentSleep: null | { intervalId: string; startedAt: string };
}
```

- [ ] **Step 1: Write RED rolling-window tests**

At exactly `asOf - 24h`, include events according to SQL predicate `occurred_at >= windowStart AND occurred_at <= asOf`; exclude older rows and voided rows. Assert bottle capacity is ignored, direct breastfeeding has count/minutes but no ml, and formula/expressed totals are both available.

- [ ] **Step 2: Write RED edit/undo tests**

Editing preserves original actor/source, increments version, records edit actor and before/after private revision snapshot, and changes current typed row. Undo marks event `voided` instead of deleting it, adds a revision, removes it from summary/quick-values/timeline-active queries, and preserves auditability.

- [ ] **Step 3: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-query.integration.test.ts test/care-revision.integration.test.ts
```

- [ ] **Step 4: Implement GREEN query/revision services and routes**

Do not load full care payloads into diagnostic events. API errors expose event id/type and warning codes only.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/care apps/api/src/care/query-service.ts apps/api/src/care/revision-service.ts apps/api/src/routes/care-query.ts apps/api/src/routes/care-revisions.ts apps/api/src/app.ts apps/api/test/care-query.integration.test.ts apps/api/test/care-revision.integration.test.ts
git commit -m "feat: add care summary timeline and corrections"
```

---

### Task 8: Web Care Workspace, Summary, Feeding, Diaper, and Sleep Fast Paths

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

**Interfaces:**

`BabyCareApi` gains methods matching Tasks 4-7. `CareWorkspace` receives `{ api, session }`; it never receives separate actor/family/baby ids for write bodies.

- [ ] **Step 1: Write RED Web tests for the high-frequency paths**

Assert:

- authenticated home shows last feed, last diaper, rolling 24h bottle total, and current sleep from summary DTO.
- Feeding opens with `expressed breast milk / formula / direct breastfeeding`; bottle capacity values 90/150/200 are not rendered as intake quick buttons.
- when quick-values API returns `[45, 60, 75]`, those three buttons render plus `Other`.
- direct breastfeeding flow requests only total minutes.
- urine diaper can be saved after selecting `尿` and submit; stool reveals optional detail controls progressively.
- sleep buttons include `现在`, `10分钟前`, `20分钟前`, `30分钟前`, `自定义`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-workspace.test.tsx
```

- [ ] **Step 3: Implement minimal fast-path UI**

Keep primary buttons reachable without scrolling on a normal mobile viewport where practical. Disable the exact submit button while one request is in flight, reuse the same `clientRequestId` on deliberate retry, and preserve form state after network failure.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-workspace.test.tsx
git add apps/web/src/care apps/web/src/api-client.ts apps/web/src/auth/AuthenticatedShell.tsx apps/web/src/App.tsx apps/web/src/app.css apps/web/test/care-workspace.test.tsx
git commit -m "feat: add M2 fast care recording workspace"
```

---

### Task 9: Web Other Care Events, Warning Confirmation, Recent Edit/Undo

**Files:**
- Create: `apps/web/src/care/OtherCareForm.tsx`
- Create: `apps/web/src/care/RecentRecordCard.tsx`
- Create: `apps/web/src/care/CareWarningDialog.tsx`
- Modify: `apps/web/src/care/CareWorkspace.tsx`
- Modify: `apps/web/src/care/useCareWorkspace.ts`
- Test: `apps/web/test/care-workspace.test.tsx`

**Interfaces:**

Warnings shown to the user contain only type/reason/recent-event summary. `继续记录` resubmits the unchanged care input with the current warning code in `confirmedWarnings`. `Edit` uses the typed union from `EditCareEventInputSchema`. `Undo` requires an explicit click and refreshes summary/recent record after success.

- [ ] **Step 1: Extend RED Web tests**

Cover burping/spit-up/crying/bathing/temperature/weight/medication entry, duplicate warning dialog, unusual bottle amount confirmation, save failure retaining entered fields, recent record exposing `修改` and `撤销`, and no medication recommendation copy.

- [ ] **Step 2: Implement GREEN UI and commit**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-workspace.test.tsx
git add apps/web/src/care apps/web/test/care-workspace.test.tsx
git commit -m "feat: add care warnings corrections and frequent events"
```

---

### Task 10: Cross-Caregiver, Privacy, and Concurrent Integration Gate

**Files:**
- Modify/Create: `apps/api/test/care-event.integration.test.ts`
- Modify/Create: `apps/api/test/care-revision.integration.test.ts`
- Create: `apps/api/test/care-concurrency.integration.test.ts`
- Modify: `apps/api/test/audit.integration.test.ts`

**Interfaces:** No new production interfaces unless a test exposes a real defect.

- [ ] **Step 1: Add RED integration cases**

Run Dad and Nanny writes concurrently and verify distinct authenticated `actor_user_id`, `actor_membership_id`, same family/baby, `source=manual`, no lost rows, and no ability to forge another actor. Verify care audit rows contain event ids/types/action names but do not dump medication dose/name, temperatures, weights, notes, cookies, session tokens, or setup token.

- [ ] **Step 2: Run focused integration**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-event.integration.test.ts test/care-revision.integration.test.ts test/care-concurrency.integration.test.ts test/audit.integration.test.ts
```

- [ ] **Step 3: Fix only proven defects, rerun GREEN, commit**

```bash
git add apps/api/test apps/api/src/care
git commit -m "test: harden M2 caregiver attribution and privacy"
```

---

### Task 11: Production Compose M2 E2E, Status Files, and Final Release Gate

**Files:**
- Modify: `scripts/compose-smoke.mjs`
- Modify: `README.md`
- Modify: `docs/PLAN.md`
- Modify: `.agent/current-milestone.json`
- Modify only if needed by proven production behavior: `compose.yaml`, `infra/docker/*`, `.github/workflows/ci.yml`

**Interfaces:** Production release flow extends the existing M1 smoke; it does not replace it.

- [ ] **Step 1: Extend Compose smoke with the approved M2 flow**

After existing empty-DB migration/setup/login/authorization checks, perform through production Web/API routing:

```text
Dad login
-> formula bottle feed actual 60ml with optional 150ml bottle capacity
-> direct breastfeeding 18min
-> diaper urine+stool with detail
-> sleep start 20 minutes ago
-> query summary (60ml bottle total, 1 breastfeeding session, 18min)
-> edit bottle feed from 60ml to 65ml
-> query summary (65ml)
-> undo edited feeding event
-> query summary (0ml bottle total; breastfeeding remains 18min)
-> Nanny login
-> Nanny records diaper/care event
-> query timeline and verify Nanny actor attribution
```

The smoke must prove bottle capacity never enters the total and must keep all existing M1 authorization assertions.

- [ ] **Step 2: Run focused production Compose smoke before status changes**

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down -v --remove-orphans
```

Expected: PASS from an empty database with migrations executed by production startup.

- [ ] **Step 3: Update final project status files before final CI**

`docs/PLAN.md` must mark M2 implementation complete only if all implementation tasks above are green. `.agent/current-milestone.json` must record exact M2 implementation branch/head intent and next milestone. README should describe actual available care flows, not aspirational behavior.

Do not mark M3/Guardian complete.

- [ ] **Step 4: Run pre-final self-review**

Check:

- no `feeding` capacity used as intake shortcut.
- no left/right breastfeeding timers.
- no hard-coded Nanny shift.
- no Guardian/JoyAI/Qwen imports or routes.
- no medication recommendation logic.
- no client-supplied actor/family/baby ownership on manual writes.
- no destructive undo deletes.
- no full care payloads in diagnostics.
- no TODO/TBD/placeholders in M2 production paths.

- [ ] **Step 5: Push exact final head and require fresh permanent CI**

Final GitHub Actions head must be a single commit SHA containing code + migrations + Web + Compose smoke + `docs/PLAN.md` + `.agent/current-milestone.json`.

Required results on that exact HEAD:

```text
static                   PASS
unit/contracts           PASS
PostgreSQL integration   PASS
production build         PASS
production Compose smoke PASS
```

- [ ] **Step 6: Verification-before-completion review and Draft PR**

Use `superpowers:verification-before-completion` before claiming M2 complete. Review final diff against the approved spec, then create/update an M2 Draft PR based on `codex/m1-family-baby-foundation`; do not merge `main`.

- [ ] **Step 7: Commit status/docs if they were not already in the exact final head**

If any status/doc change occurred after the last 5/5 run, that invalidates the final evidence: run the full 5-job gate again on the new exact head before completion.
