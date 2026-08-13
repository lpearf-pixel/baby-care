# M2 Care Recording MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved M2 newborn care recorder for `xiangxiang`: mixed feeding, diaper/stool, sleep backfill, burping/spit-up/crying/bathing, temperature/weight/medication facts, deterministic warnings/shortcuts, edit/undo, rolling 24-hour summary, and a fast Web/PWA recording flow.

**Architecture:** Implement on `codex/m2-care-recording-implementation`, created directly from verified M1 HEAD `76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`. Use one normalized `care_events` envelope with typed child tables, deterministic domain rules, strict Zod contracts, focused Fastify services/routes, and small React care components. Keep M1 authentication/authorization authoritative and derive all ownership from the authenticated session.

**Tech Stack:** Node 24+, TypeScript, pnpm 10.17.1, Fastify, PostgreSQL 16, Drizzle ORM/Kit, Zod, React/Vite PWA, Vitest, Testing Library, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Approved spec is copied unchanged to this branch from `codex/m2-care-recording-mvp @ eadb8f1d41770b5ef940f16993e57a4cb8ee6bc5`.
- M1-H is already closed; authoritative M1 CI `31707486985` is 5/5 PASS. Section 21 of the preserved spec is historical and satisfied, not an implementation task.
- Do not modify or merge `main`.
- 90/150/200 ml are bottle capacities only. They never become default intake buttons and never enter intake totals.
- Bottle milk types are `expressed_breast_milk` and `formula`.
- Direct breastfeeding records total minutes only; no left/right timers and no inferred ml.
- Bottle quick values are per milk type: last 20 active bottle components, exact-ml frequency descending, tie by latest use descending, top 3.
- Sleep offers now / 10 / 20 / 30 minutes ago / custom. More than 5 minutes in the future is invalid. More than 24 hours old is allowed but emits an `old_backfill` soft confirmation warning.
- Duplicate warnings use a conservative 5-minute window and never silently merge facts.
- Every manual write includes `clientRequestId: UUID`; retries with the same authenticated actor/family/request id return the original result.
- Manual requests never accept `familyId`, `babyId`, `actorUserId`, `actorMembershipId`, or `source`; server derives them from M1 session context and assigns `source='manual'`.
- Medication stores administered facts only. No recommendation or dose calculation.
- No fixed Nanny shift, Guardian, JoyAI, Qwen, automated feeding recognition, full offline sync, or M3 advanced timeline/handoff UX.

---

## Target File Structure

### Contracts

Create `packages/contracts/src/care/`:

- `common.ts` — shared event/write/warning DTOs.
- `feeding.ts` — feeding session/component contracts.
- `diaper.ts` — diaper/stool contracts.
- `sleep.ts` — sleep contracts.
- `actions.ts` — burping/spit-up/crying/bathing/medication contracts.
- `measurements.ts` — temperature/weight contracts.
- `query.ts` — summary/timeline/quick-values DTOs.
- `revisions.ts` — edit/undo union.
- `index.ts` — exports.

Modify `packages/contracts/src/errors.ts` and `packages/contracts/src/index.ts`.

### Domain

Create `packages/domain/src/care/`:

- `quick-values.ts`
- `time.ts`
- `warnings.ts`
- `index.ts`

Modify `packages/domain/src/identity.ts`, `policy.ts`, and `index.ts`.

### API

Create `apps/api/src/care/`:

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

Create routes:

- `apps/api/src/routes/care-feeding.ts`
- `apps/api/src/routes/care-diaper.ts`
- `apps/api/src/routes/care-sleep.ts`
- `apps/api/src/routes/care-actions.ts`
- `apps/api/src/routes/care-measurements.ts`
- `apps/api/src/routes/care-query.ts`
- `apps/api/src/routes/care-revisions.ts`

Modify `apps/api/src/schema.ts` and `apps/api/src/app.ts`; generate `migrations/0001_m2_care_recording.sql` plus Drizzle metadata.

### Web

Create `apps/web/src/care/`:

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

Modify `apps/web/src/api-client.ts`, `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/App.tsx`, and `apps/web/src/app.css`.

---

### Task 1: Common Care Contracts, Policy, Schema, and Migration

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

**Produces:**

```ts
type CareSource = 'manual' | 'guardian' | 'device' | 'import' | 'ai';
type CareEventStatus = 'active' | 'voided';
type CareWarningCode = 'possible_duplicate' | 'unusual_value' | 'sleep_overlap' | 'old_backfill';

type CareWriteMetaInput = {
  occurredAt: string;
  clientRequestId: string;
  note?: string;
  confirmedWarnings?: CareWarningCode[];
};
```

Add `care.read` and `care.write`; caregiver receives both but still cannot `family.update` or `members.manage`.

**Database model:**

`care_events` contains event ownership/source/status/version/idempotency/trace metadata. Typed child tables are:

- `feeding_sessions`
- `feeding_components`
- `diaper_events`
- `sleep_intervals`
- `care_actions`
- `measurements`
- `care_event_revisions`

Add positive-value check constraints and `ended_at >= started_at`.

Ownership must also be protected by PostgreSQL, not only service code:

1. add a unique key/index on `babies(id, family_id)`;
2. add a unique key/index on `family_memberships(id, user_id, family_id)`;
3. `care_events(baby_id, family_id)` has a composite FK to `babies(id, family_id)`;
4. for human manual events, `(actor_membership_id, actor_user_id, family_id)` references the membership composite key;
5. `client_request_id` has a partial unique index on `(family_id, actor_user_id, client_request_id)` when non-null.

- [ ] **Step 1: Write RED contract/policy tests**

```ts
expect(CareWriteMetaInputSchema.safeParse({
  occurredAt: '2026-08-13T10:00:00.000Z',
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  actorUserId: 'forged',
}).success).toBe(false);

expect(can('caregiver', 'care.write')).toBe(true);
expect(can('caregiver', 'family.update')).toBe(false);
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
pnpm --filter @baby-care/domain exec vitest run test/care-policy.test.ts
```

Expected: FAIL because care contracts/capabilities are absent.

- [ ] **Step 3: Implement contracts/policy/schema and generate migration**

Use the repo's existing Drizzle workflow. Generate a migration named `m2_care_recording`; do not hand-edit Drizzle metadata.

- [ ] **Step 4: Write and run migration RED/GREEN tests**

Verify clean M1 -> M2 migration, negative-value rejection, baby/family mismatch rejection, actor/membership/family mismatch rejection, and idempotency uniqueness.

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

**Produces:**

```ts
interface BottleAmountHistory { amountMl: number; occurredAt: Date }
function rankRecentBottleAmounts(records: readonly BottleAmountHistory[]): number[];

function validateOccurredAt(occurredAt: Date, now: Date):
  | { ok: true; warning: null | 'old_backfill' }
  | { ok: false; reason: 'future_timestamp' };

interface DuplicateCandidate {
  eventType: string;
  occurredAt: Date;
  fingerprint: string;
}
function findDuplicateWarning(candidate: DuplicateCandidate, recent: readonly DuplicateCandidate[]): CareWarning | null;
function findBottleSanityWarning(amountMl: number, recentAmounts: readonly number[]): CareWarning | null;
```

Rules:

- `validateOccurredAt`: <= +5 minutes accepted; > +5 minutes rejected; >24h old returns `old_backfill` warning but remains confirmable.
- duplicate window: absolute time difference <=5 minutes and exact fingerprint match.
- fingerprints:
  - bottle: `feeding:bottle:<liquidType>:<amountMl>`
  - direct breastfeeding: `feeding:direct:<durationMinutes>`
  - diaper: `diaper:<kind>`
  - care action: `action:<kind>`
  - measurement: `measurement:<kind>:<exact canonical value>`
- unusual bottle amount: if at least 3 recent positive values exist, compute median; warn when candidate >=3x median or <= median/3. Never modify amount.

- [ ] **Step 1: Write RED quick-value tests**

```ts
expect(rankRecentBottleAmounts([
  { amountMl: 60, occurredAt: new Date('2026-08-13T10:00:00Z') },
  { amountMl: 50, occurredAt: new Date('2026-08-13T09:00:00Z') },
  { amountMl: 60, occurredAt: new Date('2026-08-13T08:00:00Z') },
])).toEqual([60, 50]);
```

Also prove only the newest 20 rows participate, max 3 unique values, and tie-breaking uses latest occurrence.

- [ ] **Step 2: Write RED time/warning tests**

```ts
expect(validateOccurredAt(new Date('2026-08-13T10:05:00Z'), new Date('2026-08-13T10:00:00Z')))
  .toEqual({ ok: true, warning: null });
expect(validateOccurredAt(new Date('2026-08-13T10:05:01Z'), new Date('2026-08-13T10:00:00Z')))
  .toEqual({ ok: false, reason: 'future_timestamp' });
```

- [ ] **Step 3: RED -> minimal implementation -> GREEN -> commit**

```bash
pnpm --filter @baby-care/domain exec vitest run test/care-rules.test.ts
git add packages/domain/src/care packages/domain/src/index.ts packages/domain/test/care-rules.test.ts
git commit -m "feat: add deterministic M2 care rules"
```

---

### Task 3: Care Ownership, Idempotency, and Revision Primitives

**Files:**
- Create: `apps/api/src/care/care-errors.ts`
- Create: `apps/api/src/care/care-auth.ts`
- Create: `apps/api/src/care/care-event-repository.ts`
- Test: `apps/api/test/care-event.integration.test.ts`

**Produces:**

```ts
interface CareActorContext extends AuthContext { babyId: string }

createCareEvent(client, input): Promise<CareEventRow>
findByClientRequestId(client, context, clientRequestId): Promise<CareEventRow | null>
loadActiveCareEventForUpdate(client, context, eventId): Promise<CareEventRow | null>
appendCareRevision(client, input): Promise<void>
voidCareEvent(client, input): Promise<void>
```

`care-auth.ts` reuses the existing M1 `AuthService`, checks `care.read` / `care.write`, and uses the existing Origin guard for unsafe methods.

- [ ] **Step 1: Write RED repository/auth integration tests**

Use a test-only Fastify route wired through `care-auth.ts` to prove Dad/Mom/Nanny context derives the correct family/baby/actor ids; disabled membership fails. Call repository primitives inside transactions to prove same client request id resolves to the existing event.

- [ ] **Step 2: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-event.integration.test.ts
```

- [ ] **Step 3: Implement GREEN and commit**

Audit rows contain only care action name, event id/type, actor, source, trace id; do not copy notes, medication values, temperature, or weight into audit metadata.

```bash
git add apps/api/src/care apps/api/test/care-event.integration.test.ts
git commit -m "feat: add authenticated care event foundation"
```

---

### Task 4: Mixed Feeding Sessions and Quick-Value API

**Files:**
- Create: `packages/contracts/src/care/feeding.ts`
- Modify: `packages/contracts/src/care/index.ts`
- Create: `apps/api/src/care/feeding-service.ts`
- Create: `apps/api/src/routes/care-feeding.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/feeding.integration.test.ts`

**Routes:**

- `POST /api/care/feeding-sessions`
- `GET /api/care/feeding/quick-values?liquidType=expressed_breast_milk|formula`

**Input:**

```ts
type CreateFeedingSessionInput = CareWriteMetaInput & {
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

Unconfirmed warnings return HTTP 409, `code='care_confirmation_required'`, `details.warnings`. No row is written. Resubmit unchanged input with the returned warning code in `confirmedWarnings` to continue.

- [ ] **Step 1: RED tests**

Cover actual bottle ml, optional bottle capacity not affecting totals, direct breastfeeding total minutes only, mixed session with related burp/spit-up, separate formula/expressed shortcut histories, 600-vs-60 sanity warning, duplicate warning, explicit confirmation, and idempotent retry.

- [ ] **Step 2: Run RED**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/feeding.integration.test.ts
```

- [ ] **Step 3: Implement transactionally and GREEN**

One transaction creates envelope/session/components/related action events/audit. Query only active same-liquid bottle components for recent-20 ranking.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/care apps/api/src/care/feeding-service.ts apps/api/src/routes/care-feeding.ts apps/api/src/app.ts apps/api/test/feeding.integration.test.ts
git commit -m "feat: add mixed feeding sessions"
```

---

### Task 5: Diaper/Stool and Sleep

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

- `POST /api/care/diapers`
- `POST /api/care/sleep/start`
- `POST /api/care/sleep/wake`

**Diaper input:**

```ts
CareWriteMetaInput & {
  kind: 'urine' | 'stool' | 'urine_stool';
  stoolColor?: string;
  stoolConsistency?: string;
  stoolAmount?: string;
}
```

Stool details remain optional even when stool is present; urine-only saves without expanded fields.

- [ ] **Step 1: RED tests**

Cover urine-only, detailed stool, duplicate warning, exactly +5min accepted, >+5min rejected, >24h soft confirmation, wake before start rejected, second open sleep emits `sleep_overlap` instead of silently closing another interval.

- [ ] **Step 2: RED -> GREEN -> commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/diaper-sleep.integration.test.ts
git add packages/contracts/src/care apps/api/src/care/diaper-service.ts apps/api/src/care/sleep-service.ts apps/api/src/routes/care-diaper.ts apps/api/src/routes/care-sleep.ts apps/api/src/app.ts apps/api/test/diaper-sleep.integration.test.ts
git commit -m "feat: add diaper and sleep recording"
```

---

### Task 6: Burping, Spit-up, Crying, Bathing, Medication, Temperature, Weight

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

- `POST /api/care/actions`
- `POST /api/care/measurements`

**Action union:**

```ts
{ kind:'burping', ...CareWriteMetaInput }
{ kind:'spit_up', amount:'small'|'medium'|'large', ...CareWriteMetaInput }
{ kind:'crying', durationMinutes?:number, ...CareWriteMetaInput }
{ kind:'bathing', ...CareWriteMetaInput }
{ kind:'medication', medicationName:string, dose:number, doseUnit:string, ...CareWriteMetaInput }
```

**Measurement union:**

```ts
{ kind:'temperature', valueCelsius:number, method?:string, ...CareWriteMetaInput }
{ kind:'weight', valueKg:number, ...CareWriteMetaInput }
```

- [ ] **Step 1: RED tests**

Verify positive canonical values, actor/source attribution, no medication recommendation/calculation fields or endpoints, and no sensitive care values/notes in diagnostics/audit metadata.

- [ ] **Step 2: RED -> GREEN -> commit**

```bash
DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-actions.integration.test.ts
git add packages/contracts/src/care apps/api/src/care apps/api/src/routes apps/api/src/app.ts apps/api/test/care-actions.integration.test.ts
git commit -m "feat: add frequent care actions and measurements"
```

---

### Task 7: Rolling 24-Hour Summary, Timeline, Edit, and Undo

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

- `GET /api/care/summary?at=<ISO>`
- `GET /api/care/timeline?before=<ISO>&limit=<1..50>`
- `PATCH /api/care/events/:eventId`
- `POST /api/care/events/:eventId/undo`

**Summary:**

```ts
interface CareHomeSummaryDto {
  asOf: string;
  lastFeeding: null | {
    occurredAt: string;
    bottle?: { liquidType: 'expressed_breast_milk'|'formula'; amountMl: number };
    directBreastfeedingMinutes?: number;
  };
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

Window predicate is inclusive: `occurred_at >= asOf - interval '24 hours' AND occurred_at <= asOf`, active rows only.

**Edit union:**

```ts
type EditCareEventInput =
  | { eventType:'feeding'; occurredAt:string; note?:string; components:CreateFeedingSessionInput['components']; relatedActions?:CreateFeedingSessionInput['relatedActions'] }
  | { eventType:'diaper'; occurredAt:string; note?:string; kind:'urine'|'stool'|'urine_stool'; stoolColor?:string; stoolConsistency?:string; stoolAmount?:string }
  | { eventType:'sleep'; startedAt:string; endedAt?:string|null; note?:string }
  | { eventType:'burping'|'spit_up'|'crying'|'bathing'|'medication'; payload:CareActionEditPayload; occurredAt:string; note?:string }
  | { eventType:'temperature'|'weight'; payload:MeasurementEditPayload; occurredAt:string; note?:string };
```

Server verifies the union discriminator matches stored event type.

- [ ] **Step 1: RED query tests**

Assert 24h boundary, capacity exclusion, formula/expressed subtotals, breastfeeding count/minutes with no ml, voided-row exclusion, last feed/diaper, and current open sleep.

- [ ] **Step 2: RED revision tests**

Editing keeps original actor/source, increments version, records editor and private before/after revision. Undo changes status to `voided`; never DELETE. Voided event disappears from active timeline/summary/quick-values.

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

- first screen shows last feed, last diaper, rolling 24h bottle total, current sleep when present;
- feeding choices are expressed milk / formula / direct breastfeeding;
- 90/150/200 do not appear as amount shortcuts;
- API quick values `[45,60,75]` render exactly those + `其他`;
- direct breastfeeding asks only total minutes;
- urine diaper stays minimal; stool reveals optional details;
- sleep buttons are `现在`, `10分钟前`, `20分钟前`, `30分钟前`, `自定义`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-workspace.test.tsx
```

- [ ] **Step 3: Implement GREEN**

Disable a submit button during its request. Reuse the same `clientRequestId` on deliberate retry. Preserve current form fields after network failure. Keep family-admin UI below/aside the care workspace; Nanny sees the same care tools but existing M1 admin restrictions remain.

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

- [ ] **Step 1: Add RED tests**

Cover burping, spit-up, crying, bathing, temperature, weight, medication facts, duplicate/unusual/old-backfill/sleep-overlap confirmations, save failure retaining fields, and recent record `修改` / `撤销`.

- [ ] **Step 2: Implement warning confirmation**

`继续记录` resubmits the unchanged input with the warning code added to `confirmedWarnings`; no auto-normalization or silent merge.

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

Perform Dad and Nanny writes concurrently. Assert distinct authenticated actor/membership ids, same family/baby, `source=manual`, no lost rows, no actor forgery, and disabled membership rejection.

Assert audit/compact diagnostics do not contain medication name/dose, temperature value, weight value, note body, cookie, session token, or setup token.

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

- [ ] **Step 1: Extend existing M1 production smoke**

Keep all M1 empty-DB/setup/session/authorization assertions, then run through production routing:

```text
Dad login
-> create formula feeding session: actual 60ml, bottle capacity 150ml
-> create a separate direct-breastfeeding session: 18min
-> create urine+stool diaper with detail
-> start sleep 20 minutes ago
-> query summary: bottleTotal=60, breastfeedingSessions=1, breastfeedingMinutes=18
-> edit bottle session 60 -> 65
-> query summary: bottleTotal=65
-> undo bottle session
-> query summary: bottleTotal=0, breastfeedingMinutes=18
-> Nanny login
-> Nanny creates a care event
-> query timeline and verify Nanny actor attribution
```

This proves bottle capacity never enters totals and preserves the M1 production authorization path.

- [ ] **Step 2: Run focused production Compose smoke from empty DB**

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down -v --remove-orphans
```

- [ ] **Step 3: Update status/docs BEFORE final CI**

Only after Tasks 1-10 are green:

- `docs/PLAN.md`: M2 implementation complete; M3 remains next/independent.
- `.agent/current-milestone.json`: record M2 branch, completed status, verified M1 baseline, design source, and next milestone.
- `README.md`: document real M2 flows only.

No status/doc change is allowed after the final CI without re-running final CI.

- [ ] **Step 4: Pre-final scope review**

Search final diff for:

```text
left/right breastfeeding timers = absent
90/150/200 intake shortcut defaults = absent
hard-coded Nanny shift = absent
Guardian/JoyAI/Qwen = absent
medication recommendation logic = absent
client-supplied actor/family/baby ownership = absent
DELETE-based undo = absent
full private care payload diagnostics = absent
TODO/TBD production paths = absent
```

- [ ] **Step 5: Exact-final-head CI**

Push the exact head containing implementation + migration + Web + Compose smoke + final status files. Require fresh:

```text
static                   PASS
unit/contracts           PASS
PostgreSQL integration   PASS
production build         PASS
production Compose smoke PASS
```

All five results must belong to the same final commit SHA.

- [ ] **Step 6: Verification and Draft PR**

Invoke `superpowers:verification-before-completion`, review the final diff against the preserved approved spec, then create/update an M2 Draft PR with base `codex/m1-family-baby-foundation`. Do not merge `main`.
