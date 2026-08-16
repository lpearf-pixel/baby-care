# M3 Care Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved M3 operational care workspace: explicit caregiver takeover, derived handoff briefing, typed paginated timeline, safe historical correction and revision history, optional non-authoritative reminders, and low-disturbance day/night Web/PWA use.

**Architecture:** Start a new `codex/m3-care-workspace-implementation` branch from verified design baseline `c31ee428018f7d550572a905f652fb2f317b9b60`. Keep PostgreSQL care events and revisions authoritative; store handoff checkpoints as separate typed facts, derive briefings and timeline read models at query time, enforce stale-write protection with expected versions, and add focused React workspace components without rewriting the M2 recording forms.

**Tech Stack:** Node 24+, TypeScript, pnpm 10.17.1, Fastify, PostgreSQL 16, Drizzle ORM/Kit, Zod, React/Vite PWA, Vitest, Testing Library, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-15-m3-care-workspace-design.md` at `c31ee428018f7d550572a905f652fb2f317b9b60`.
- Verified design baseline CI: run `31924237529`, static/unit/PostgreSQL integration/build/production Compose 5/5 PASS.
- Create `codex/m3-care-workspace-implementation` from exact commit `c31ee428018f7d550572a905f652fb2f317b9b60`; do not put M3 business code on the M2 branch.
- A future M3 Draft PR targets `codex/m2-care-recording-implementation`; do not modify or merge `main`.
- An incoming caregiver explicitly creates `我来接手`; actor changes, reminders, schedules, camera observations, and model outputs never create handoff facts automatically.
- A handoff briefing is derived from active authoritative records between the previous checkpoint and the new checkpoint. With no previous checkpoint, use the preceding 24 hours and label it `最近24小时`.
- Fixed-time reminders are optional in-app prompts. They never create, edit, or imply a checkpoint.
- Existing M2 meanings remain fixed: bottle intake is actual consumed ml, bottle capacity is metadata only, expressed milk and formula stay separate, direct breastfeeding is minutes only, rolling summaries use actual occurrence time, and medication is factual with no recommendation or dose calculation.
- Edit remains append-only; undo remains void-based; no physical care-record deletion is added.
- Historical edit and undo require `expectedVersion`; stale writes return `care_state_conflict` and never silently overwrite.
- Manual family, baby, actor, membership, and source fields remain server-derived from the authenticated session.
- `auto/day/night` display choice is stored per browser/device. M3 Web plays no acknowledgement sound.
- Xiaomi audio, wake word, ASR, TTS, Voice Care Gateway, Guardian ingestion, AI inference, configurable spoken volume, and default-milk voice suggestions remain outside M3.
- Use RED -> verify failure -> minimal GREEN -> focused regression -> commit for every task. Cross-runtime tasks also require exact-head CI before the next dependent slice.
- Task commits are local by default. Every `git push` and Draft PR operation in this plan is conditional on explicit remote-operation authorization in the executing session.
- Compact diagnostics must not contain notes, milk amounts, medication facts, temperatures, weights, cookies, setup tokens, session tokens, audio, camera frames, or revision snapshots.

---

## System Engineering Blueprint

### 1. Mission and non-goals

- **Outcome:** A sleep-deprived Dad, Mom, or Nanny can take over care, understand recorded facts, correct mistakes, and hand off again without relying on memory or an inferred schedule.
- **Beneficiaries:** `xiangxiang` and the three authenticated caregiver roles.
- **Time horizon:** Birth Ready M3, while keeping interfaces replaceable for later local voice integration.
- **Unacceptable harms:** invented care facts, silent overwrites, medication advice, cross-family disclosure, reminders presented as completed handoffs, or night UI that hides important warnings.
- **System proof:** the production flow completes takeover -> briefing -> timeline -> correction -> recalculated briefing -> next takeover with full attribution and five CI gates green.
- **Non-goals:** all audio/AI/Guardian and medical-decision behavior listed in Global Constraints.

### 2. Stakeholders and boundary

| Actor/system | Role | Inputs | Outputs | Constraint |
|---|---|---|---|---|
| Dad/Mom | Family admin and caregiver | Takeover, care facts, corrections, reminder rules | Briefing, timeline, audit history | Normal care rules apply |
| Nanny | Caregiver | Same care/takeover facts; own reminders | Same care workspace | No family administration |
| Baby Care API | Authority boundary | Authenticated typed requests | Typed facts/read models/errors | Never trust client ownership |
| PostgreSQL | Source of truth | Events, revisions, checkpoints, configuration | Transactional facts | No direct Guardian writes |
| Web/PWA | Interaction and correction surface | User actions, display preference | Low-disturbance UI | No Web audio |
| Future Voice Gateway | External future adapter | Confirmed semantic candidates | Versioned API calls | Not implemented in M3 |

- **Controlled:** explicit takeover writes, reminder configuration, timeline filters, edit/undo requests, display mode.
- **Directly observed facts:** authenticated actor, care events, revisions, handoff checkpoints.
- **Derived states:** briefing aggregates, current sleep, backfill marker, reminder visibility.
- **Inferred states:** none in M3.
- **Unknown:** final household quiet hours and proven Xiaomi audio behavior; neither blocks M3.

### 3. Context and feedback loop

```text
incoming caregiver explicitly takes over
-> Baby Care stores an attributable checkpoint
-> Baby Care derives the fixed briefing interval
-> caregiver reviews facts and timeline
-> caregiver corrects or voids a wrong fact
-> Baby Care preserves revision evidence and recomputes the briefing
-> the next caregiver takes over and validates the updated state
```

Each write is synchronous and transactional. Read failures are isolated from quick recording. Human correction is the only intervention in this loop; there is no model decision.

### 4. Subsystems and interfaces

| Subsystem | Responsibility | Input | Output | Failure behavior |
|---|---|---|---|---|
| Handoff facts | Idempotent explicit takeover | authenticated create input | checkpoint receipt | rollback transaction |
| Handoff briefing | Fixed-window derived facts | checkpoint ID | typed briefing | explicit unavailable state |
| Timeline read model | Typed, stable pagination | cursor/filter/window | items + next cursor | reject invalid cursor |
| Revision control | Safe historical correction | expected version + typed edit | new version/history | 409 conflict on stale input |
| Reminder policy | Current-caregiver prompts | rules + family time | visible prompt state | never creates facts |
| Web workspace | Present and mutate through API | typed DTOs | accessible operational UI | preserve drafts; independent retry |

All read-model implementations are replaceable behind contracts. Consumers do not read table internals.

### 5. Observation–hypothesis–decision model

- **Observations:** care-event rows, revision rows, checkpoint rows, authenticated actor, family timezone.
- **Hypotheses:** none are persisted as facts in M3.
- **Decisions:** only human-triggered takeover/edit/undo and deterministic reminder visibility.
- **Outcomes:** write receipt, updated version, recalculated briefing, or explicit error.
- **Provenance:** actor, source, effective time, created time, trace ID, client request ID, and revision metadata remain queryable.

### 6. Minimum closed-loop pilot

- **Domain:** one family, one baby, Dad and Nanny.
- **Entry:** M2 exact baseline and migration pass.
- **Evidence:** feed, diaper, sleep, medication fact, checkpoint, correction, revision.
- **Intervention:** Dad edits one recorded feeding amount using the current version.
- **Immediate validation:** the briefing changes and the revision appears.
- **Delayed validation:** Nanny's next takeover sees the corrected fixed-window briefing.
- **Human review:** warning confirmation, older-record undo confirmation, and stale conflict refresh.
- **Stop rule:** any invented fact, cross-family access, silent overwrite, or reminder-created checkpoint blocks advancement.

### 7. Metrics and validation

- Component health: API status, bounded query count, cursor stability, Web accessibility, CI gate latency.
- Decision quality: stale-write conflicts detected, zero silent overwrites, zero reminder-created checkpoints.
- System outcome: takeover-to-briefing succeeds, correction is reflected, common recording remains two to three taps.
- Audit quality: every mutation has actor/source/trace; compact diagnostics contain no private payloads.

### 8. Human review and escalation

- Duplicate/unusual/old-backfill/sleep-overlap warnings preserve M2 confirmation behavior.
- Older-record undo requires confirmation.
- Stale changes require review of the latest record.
- Medication remains explicit factual input with no recommendation.
- Hardware/audio acceptance remains a separate real-device gate.

### 9. Risks, unknowns, and reversible decisions

| Risk | Evidence today | Test | Reversible response |
|---|---|---|---|
| Briefing query becomes N+1 | M2 timeline has envelope-only query | bounded-query integration assertion | replace read-model loader without changing DTO |
| Cursor duplicates/omits equal times | M2 orders by times and ID but has no cursor | identical-time pagination test | change opaque cursor codec |
| Stale Web edit overwrites family correction | M2 row lock lacks client expected version | concurrent edit test | return conflict and refresh |
| Reminder is mistaken for fact | No M2 reminder model | DB/API invariant test | disable prompt subsystem |
| Night theme harms warning legibility | current CSS follows system colors only | Web semantic/class assertions | revert per-device theme without data migration |

### 10. Stage gates

| Gate | Scope | Exit evidence | Forbidden expansion |
|---|---|---|---|
| G1 | Contracts/schema/domain | clean migration + unit/contract GREEN | Web/voice work |
| G2 | Typed reads and handoff | PostgreSQL integration + bounded queries | inferred handoffs |
| G3 | Safe revisions | stale concurrency and audit GREEN | destructive edits |
| G4 | Web workspace | interaction/accessibility/night tests GREEN | audio/TTS |
| G5 | Production closure | exact-head five-job CI + Compose loop | merge/main changes |

---

## Execution Preconditions

At implementation time, use a clean checkout and create the M3 branch only from the verified design commit:

```bash
git fetch origin
git switch --create codex/m3-care-workspace-implementation c31ee428018f7d550572a905f652fb2f317b9b60
git merge-base --is-ancestor c31ee428018f7d550572a905f652fb2f317b9b60 HEAD
git status -sb
```

Expected: the ancestry command exits 0; the branch is `codex/m3-care-workspace-implementation`; the worktree has no unrelated changes. If the branch already exists, switch to it and prove its merge base is the same commit instead of recreating or resetting it.

## File Map

### Contracts and domain

- Create `packages/contracts/src/care/handoffs.ts` — takeover, briefing, and reminder DTOs.
- Modify `packages/contracts/src/care/query.ts` — typed timeline union, filters, cursor response, event detail.
- Modify `packages/contracts/src/care/revisions.ts` — versioned mutation requests and history DTOs.
- Modify `packages/contracts/src/care/index.ts` — exports.
- Create `packages/domain/src/care/workspace.ts` — backfill classification, weekday masks, reminder visibility.
- Modify `packages/domain/src/care/index.ts` — exports.

### Database and API

- Modify `apps/api/src/schema.ts` — handoff checkpoint/reminder tables.
- Generate `migrations/0002_m3_care_workspace.sql` and matching `migrations/meta/0002_snapshot.json`/journal entry.
- Create `apps/api/src/care/care-read-model.ts` — batched typed payload loading.
- Create `apps/api/src/care/timeline-cursor.ts` — opaque cursor codec.
- Create `apps/api/src/care/handoff-repository.ts` — checkpoint/reminder persistence.
- Create `apps/api/src/care/handoff-service.ts` — idempotent takeover.
- Create `apps/api/src/care/handoff-summary-service.ts` — fixed-window briefing.
- Modify `apps/api/src/care/query-service.ts` — typed timeline/detail reads.
- Modify `apps/api/src/care/revision-service.ts` — expected-version guard.
- Modify `apps/api/src/care/care-event-repository.ts` — version-aware row helpers.
- Create `apps/api/src/care/revision-query-service.ts` — revision history projection.
- Create `apps/api/src/routes/care-handoffs.ts` — handoff/reminder routes.
- Modify `apps/api/src/routes/care-query.ts` — cursor/filter/detail routes.
- Modify `apps/api/src/routes/care-revisions.ts` — versioned writes/history route.
- Modify `apps/api/src/app.ts` — register services/routes.

### Web/PWA

- Create `apps/web/src/care/HandoffPanel.tsx`, `CareTimeline.tsx`, `CareTimelineCard.tsx`.
- Create `apps/web/src/care/CareEventDetail.tsx`, `CareEventEditForm.tsx`, `CareRevisionHistory.tsx`.
- Create `apps/web/src/care/HandoffReminderSettings.tsx`, `CareDisplayMode.tsx`.
- Create `apps/web/src/care/useHandoff.ts`, `useCareTimeline.ts`, `useCareDisplayMode.ts`.
- Modify `apps/web/src/care/CareWorkspace.tsx`, `RecentRecordCard.tsx`, `RecentEditPanel.tsx`.
- Modify `apps/web/src/api-client.ts`, `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/app.css`.

### Tests and delivery

- Modify `packages/contracts/test/care-contracts.test.ts`, `packages/domain/test/care-rules.test.ts`.
- Create `apps/api/test/m3-migrations.integration.test.ts`.
- Create `apps/api/test/care-workspace-timeline.integration.test.ts`.
- Create `apps/api/test/care-handoff.integration.test.ts`.
- Create `apps/api/test/care-workspace-revision.integration.test.ts`.
- Create `apps/api/test/care-workspace-system.integration.test.ts`.
- Create `apps/web/test/care-handoff-timeline.test.tsx`.
- Create `apps/web/test/care-history-correction.test.tsx`.
- Create `apps/web/test/care-day-night-reminders.test.tsx`.
- Modify `scripts/compose-smoke.mjs`, `README.md`, `docs/PLAN.md`, `.agent/current-milestone.json`, and `summary.md` only when implemented state changes.

---

### Task 1: Workspace Contracts, Domain Rules, Schema, and Migration

**Files:**
- Create: `packages/contracts/src/care/handoffs.ts`
- Modify: `packages/contracts/src/care/query.ts`, `packages/contracts/src/care/revisions.ts`, `packages/contracts/src/care/index.ts`
- Create: `packages/domain/src/care/workspace.ts`
- Modify: `packages/domain/src/care/index.ts`, `apps/api/src/schema.ts`
- Generate: `migrations/0002_m3_care_workspace.sql`, `migrations/meta/0002_snapshot.json`, `migrations/meta/_journal.json`
- Test: `packages/contracts/test/care-contracts.test.ts`, `packages/domain/test/care-rules.test.ts`, `apps/api/test/m3-migrations.integration.test.ts`

**Interfaces produced:**

```ts
export type CreateCareHandoffInput = { occurredAt: string; clientRequestId: string };
export type CareHandoffCheckpointDto = {
  id: string; occurredAt: string; createdAt: string;
  actorUserId: string | null; actorDisplayName: string | null; source: CareSource;
};
export type HandoffReminderRuleInput = {
  localTime: string; weekdays: number[]; enabled: boolean;
};
export type ReplaceHandoffReminderRulesInput = { rules: HandoffReminderRuleInput[] };
export type CareTimelineCategory = 'all' | 'feeding' | 'diaper' | 'sleep' | 'other';
export type UpdateCareEventRequest = { expectedVersion: number; event: EditCareEventInput };
export type UndoCareEventRequest = { expectedVersion: number };

export function isCareEventBackfilled(occurredAt: Date, createdAt: Date): boolean;
export function weekdaysToMask(weekdays: readonly number[]): number;
export function maskToWeekdays(mask: number): number[];
export function isHandoffReminderVisible(input: {
  localTime: string;
  weekdayMask: number;
  enabled: boolean;
  familyTimeZone: string;
  now: Date;
}): boolean;
```

`CareTimelineItemDto` is a discriminated union with common `id/eventType/occurredAt/createdAt/updatedAt/status/source/actorUserId/actorDisplayName/note/version/isBackfilled` fields plus exactly one typed payload. `CareTimelineQuery` keeps legacy `before` while adding `cursor`, `from`, `to`, `category`, and `limit`; cursor and before are mutually exclusive. Response adds `nextCursor: string | null`.

Database additions:

```text
care_handoff_checkpoints(id, family_id, baby_id, actor_user_id, actor_membership_id,
  source, occurred_at, created_at, client_request_id, trace_id)
care_handoff_reminder_rules(id, family_id, baby_id, actor_user_id, actor_membership_id,
  local_time, weekday_mask, enabled, created_at, updated_at)
```

Use the same composite family/baby and membership identity foreign keys as `care_events`. Manual checkpoints require actor, membership, and client request ID. Idempotency is unique on `(family_id, actor_user_id, client_request_id)`. Reminder rows are owned by authenticated membership and do not reference checkpoints.

- [ ] **Step 1: Write strict RED contract tests**

```ts
expect(CreateCareHandoffInputSchema.safeParse({
  occurredAt: '2026-08-16T09:00:00+08:00',
  clientRequestId: crypto.randomUUID(),
  actorUserId: 'forged',
}).success).toBe(false);
expect(ReplaceHandoffReminderRulesInputSchema.safeParse({
  rules: [{ localTime: '08:30', weekdays: [1, 2, 3, 4, 5], enabled: true }],
}).success).toBe(true);
```

- [ ] **Step 2: Run contracts RED**

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
```

Expected: FAIL because M3 schemas are not exported.

- [ ] **Step 3: Write deterministic domain RED tests**

```ts
expect(isCareEventBackfilled(new Date('2026-08-16T08:00:00Z'), new Date('2026-08-16T08:05:00Z'))).toBe(false);
expect(isCareEventBackfilled(new Date('2026-08-16T08:00:00Z'), new Date('2026-08-16T08:05:01Z'))).toBe(true);
expect(weekdaysToMask([1, 3, 7])).toBe(69);
```

- [ ] **Step 4: Implement contracts/domain minimally and run GREEN**

```bash
pnpm --filter @baby-care/contracts exec vitest run test/care-contracts.test.ts
pnpm --filter @baby-care/domain exec vitest run test/care-rules.test.ts
```

- [ ] **Step 5: Write migration RED tests**

Prove clean `0000 -> 0001 -> 0002`, family/baby mismatch rejection, membership mismatch rejection, duplicate idempotency constraint, weekday mask `1..127`, and valid local time storage.

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/m3-migrations.integration.test.ts
```

Expected: FAIL because migration `0002` does not exist.

- [ ] **Step 6: Generate migration and matching Drizzle metadata**

```bash
pnpm exec drizzle-kit generate --name m3_care_workspace
```

Do not hand-edit `0002_snapshot.json`. Inspect generated SQL and add only constraints Drizzle cannot express; keep metadata synchronized with `apps/api/src/schema.ts`.

- [ ] **Step 7: Run focused GREEN and static checks**

```bash
pnpm --filter @baby-care/contracts test
pnpm --filter @baby-care/domain test
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/m3-migrations.integration.test.ts
pnpm typecheck
```

- [ ] **Step 8: Update milestone to implementation-in-progress and commit**

Update `.agent/current-milestone.json` and `docs/PLAN.md` with M3 branch, approved spec, plan path, and `in_progress`; retain verified M2 evidence.

```bash
git add packages/contracts packages/domain apps/api/src/schema.ts migrations apps/api/test/m3-migrations.integration.test.ts .agent/current-milestone.json docs/PLAN.md
git commit -m "feat: add M3 care workspace foundation"
```

---

### Task 2: Typed Timeline, Detail Read Model, and Stable Cursor

**Files:**
- Create: `apps/api/src/care/care-read-model.ts`, `apps/api/src/care/timeline-cursor.ts`
- Modify: `apps/api/src/care/query-service.ts`, `apps/api/src/routes/care-query.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/care-workspace-timeline.integration.test.ts`

**Consumes:** `CareTimelineQuery`, `CareTimelineItemDto`, `CareTimelineResponse` from Task 1.

**Produces:**

```ts
export type TimelineCursor = { occurredAt: string; createdAt: string; id: string };
export function encodeTimelineCursor(value: TimelineCursor): string;
export function decodeTimelineCursor(value: string): TimelineCursor;
export async function loadCareTimelinePayloads(
  client: pg.PoolClient,
  events: readonly CareEventRow[],
): Promise<Map<string, CareTimelineItemDto['payload']>>;
```

Routes:

```text
GET /api/care/timeline?before=<ISO>&limit=20
GET /api/care/timeline?cursor=<opaque>&category=<category>&from=<ISO>&to=<ISO>&limit=20
GET /api/care/events/:eventId
```

Order is `occurred_at DESC, created_at DESC, id DESC`; continuation uses strict tuple comparison. Timeline is active-only by default; authorized voided detail remains readable through direct detail/history paths.

- [ ] **Step 1: Write timeline/detail RED integration tests**

Create same-time feeding, diaper, and bathing events from Dad/Nanny. Assert typed payloads, actor/source, version, five-minute backfill boundary, category mapping, legacy before, cursor pages without overlap/gap, stable validation for a malformed/expired cursor, and cross-family detail denial.

```ts
expect(secondPage.items.some((item) => firstIds.has(item.id))).toBe(false);
expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).toEqual(expectedOrder);
```

- [ ] **Step 2: Run RED**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-workspace-timeline.integration.test.ts
```

- [ ] **Step 3: Implement cursor codec and set-based payload loader**

Use one envelope query plus bounded type-batch queries for feeding, diaper, sleep, actions, and measurements. Do not call `loadCareSnapshot()` once per item.

- [ ] **Step 4: Add bounded-query assertion**

Instrument `database.pool.query` and assert a 20-item mixed timeline stays at or below six read queries: one envelope plus at most five type batches.

- [ ] **Step 5: Run GREEN and regression**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-workspace-timeline.integration.test.ts test/care-query.integration.test.ts
pnpm typecheck
```

- [ ] **Step 6: Commit and run exact-head CI**

```bash
git add apps/api/src/care/care-read-model.ts apps/api/src/care/timeline-cursor.ts apps/api/src/care/query-service.ts apps/api/src/routes/care-query.ts apps/api/src/app.ts apps/api/test/care-workspace-timeline.integration.test.ts
git commit -m "feat: add typed care workspace timeline"
git push -u origin codex/m3-care-workspace-implementation
```

Require all five jobs green before Task 3.

---

### Task 3: Explicit Handoff, Fixed Briefing, and Reminder API

**Files:**
- Create: `apps/api/src/care/handoff-repository.ts`, `handoff-service.ts`, `handoff-summary-service.ts`
- Create: `apps/api/src/routes/care-handoffs.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/care-handoff.integration.test.ts`

**Consumes:** typed care read model from Task 2 and handoff/reminder DTOs from Task 1.

**Produces routes:**

```text
POST /api/care/handoffs
GET  /api/care/handoffs/latest
GET  /api/care/handoffs/:handoffId/summary
GET  /api/care/handoff-reminders
PUT  /api/care/handoff-reminders
```

Briefing DTO:

```ts
type CareHandoffBriefingDto = {
  checkpoint: CareHandoffCheckpointDto;
  previousCheckpoint: CareHandoffCheckpointDto | null;
  window: { mode: 'checkpoint' | 'rolling_24h'; from: string; to: string };
  careState: CareHomeSummaryDto;
  feeding: { bottleTotalMl: number; expressedBreastMilkMl: number; formulaMl: number; directBreastfeedingSessions: number; directBreastfeedingMinutes: number };
  diapers: { urine: number; stool: number; urineStool: number };
  sleep: { intervals: number; completedMinutes: number };
  notableEvents: CareTimelineItemDto[];
  notableEventCount: number;
  actorActivity: Array<{ actorUserId: string|null; actorDisplayName: string|null; eventCount: number }>;
  corrections: Array<{ eventId: string; action: 'edit'|'void'; actorDisplayName: string; createdAt: string }>;
  correctionCount: number;
};
```

Service interfaces:

```ts
export function createHandoffService(database: DatabaseContext, now?: () => Date): {
  create(actor: CareActorContext, input: CreateCareHandoffInput, traceId: string): Promise<CareHandoffBriefingDto>;
};
export function createHandoffSummaryService(database: DatabaseContext): {
  latest(actor: CareActorContext): Promise<CareHandoffBriefingDto | null>;
  byId(actor: CareActorContext, handoffId: string): Promise<CareHandoffBriefingDto>;
};
```

Notable events return at most 20 facts; count stays complete. Sleep minutes include recorded overlap of ended intervals only; current open sleep stays in `careState.currentSleep` with no invented end.

- [ ] **Step 1: Write takeover RED tests**

Prove server-derived Dad/Nanny identity, same request ID idempotency, +5 minute future policy, fixed `(previous checkpoint, new checkpoint]` boundaries, 24-hour fallback, and no outgoing action requirement.

- [ ] **Step 2: Write briefing RED tests**

Seed bottle capacity 150 with actual 60, breastfeeding 18 minutes, diaper, sleep, temperature, medication, and one revision. Assert capacity exclusion, milk separation, fixed window, actor counts, notable count, and correction metadata without interpretation.

- [ ] **Step 3: Write reminder RED tests**

Replace current actor rules, prove another caregiver cannot mutate them, query a visible reminder, and assert checkpoint count is unchanged.

```ts
expect(reminder.shouldPrompt).toBe(true);
expect(await countRows('care_handoff_checkpoints')).toBe(checkpointsBeforeReminderRead);
```

- [ ] **Step 4: Run RED**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-handoff.integration.test.ts
```

- [ ] **Step 5: Implement idempotent write and fixed-window read services**

Use one transaction for checkpoint plus audit. Audit metadata includes checkpoint ID, source, and trace ID only. Reopen by checkpoint stored time; never move `window.to` to current clock.

- [ ] **Step 6: Implement replace-all reminder configuration**

Within one transaction, delete/recreate only authenticated membership configuration. Preference deletion is allowed because reminder rows are not care facts or checkpoints.

- [ ] **Step 7: Run GREEN and focused regression**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-handoff.integration.test.ts test/care-query.integration.test.ts test/audit.integration.test.ts
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/care/handoff-repository.ts apps/api/src/care/handoff-service.ts apps/api/src/care/handoff-summary-service.ts apps/api/src/routes/care-handoffs.ts apps/api/src/app.ts apps/api/test/care-handoff.integration.test.ts
git commit -m "feat: add explicit caregiver handoff"
```

---

### Task 4: Version-Aware Correction, Undo, Detail, and Revision History

**Files:**
- Modify: `apps/api/src/care/care-event-repository.ts`, `revision-service.ts`
- Create: `apps/api/src/care/revision-query-service.ts`
- Modify: `apps/api/src/routes/care-revisions.ts`, `apps/api/src/app.ts`
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/care/CareWorkspace.tsx`, `RecentRecordCard.tsx`
- Test: `apps/api/test/care-workspace-revision.integration.test.ts`, `apps/web/test/care-workspace-advanced.test.tsx`

**Produces routes:**

```text
PATCH /api/care/events/:eventId       body { expectedVersion, event }
POST  /api/care/events/:eventId/undo  body { expectedVersion }
GET   /api/care/events/:eventId/revisions
```

Revision history returns action, actor, timestamp, `fromVersion`, `toVersion`, and typed before/after snapshots. Version numbers derive from chronological revision order with initial event version 1; no additional snapshot copy is added.

```ts
export type CareRevisionHistoryItemDto = {
  id: string;
  eventId: string;
  action: 'edit' | 'void';
  actorUserId: string;
  actorDisplayName: string;
  createdAt: string;
  fromVersion: number;
  toVersion: number;
  before: EditCareEventInput | { status: 'active' };
  after: EditCareEventInput | { status: 'voided' };
};

export function createRevisionQueryService(database: DatabaseContext): {
  list(actor: CareActorContext, eventId: string): Promise<CareRevisionHistoryItemDto[]>;
};
```

- [ ] **Step 1: Write stale-write RED integration tests**

Load version 1 twice. Dad edits with expected 1 and receives version 2. Nanny attempts stale expected 1 edit/undo and receives HTTP 409 `care_state_conflict`. Stored facts remain version 2.

- [ ] **Step 2: Write history RED tests**

Assert edit actor, before/after, versions 1->2, later void 2->3, original care actor/source preservation, family isolation, and no physical deletion.

- [ ] **Step 3: Run API RED**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-workspace-revision.integration.test.ts
```

- [ ] **Step 4: Implement expected-version guard under row lock**

After `SELECT ... FOR UPDATE`, compare current version to request before loading/mutating child payloads. Increment version for edit and void.

- [ ] **Step 5: Adapt existing recent-record Web path**

Treat a newly created event as version 1, store edit receipt versions, send versioned wrappers, and on 409 show `记录已被其他照护者修改，请刷新后确认` without discarding the draft.

- [ ] **Step 6: Run GREEN and M2 regression**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-workspace-revision.integration.test.ts test/care-revision.integration.test.ts test/care-concurrency.integration.test.ts
pnpm --filter @baby-care/web exec vitest run test/care-workspace-advanced.test.tsx
pnpm typecheck
```

- [ ] **Step 7: Commit and exact-head CI**

```bash
git add apps/api/src/care/care-event-repository.ts apps/api/src/care/revision-service.ts apps/api/src/care/revision-query-service.ts apps/api/src/routes/care-revisions.ts apps/api/src/app.ts apps/api/test/care-workspace-revision.integration.test.ts apps/web/src/api-client.ts apps/web/src/care/CareWorkspace.tsx apps/web/src/care/RecentRecordCard.tsx apps/web/test/care-workspace-advanced.test.tsx
git commit -m "feat: add safe historical care revisions"
git push
```

Require five-job CI green before historical editor work.

---

### Task 5: Web Handoff Briefing and Typed Timeline

**Files:**
- Create: `apps/web/src/care/HandoffPanel.tsx`, `CareTimeline.tsx`, `CareTimelineCard.tsx`
- Create: `apps/web/src/care/useHandoff.ts`, `useCareTimeline.ts`
- Modify: `apps/web/src/care/CareWorkspace.tsx`, `apps/web/src/api-client.ts`
- Modify: `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/app.css`
- Test: `apps/web/test/care-handoff-timeline.test.tsx`

**Consumes:** Task 2 timeline/detail routes and Task 3 handoff routes.

**Produces hooks:**

```ts
export function useHandoff(api: BabyCareApi): {
  briefing: CareHandoffBriefingDto | null;
  loading: boolean;
  busy: boolean;
  message: string | null;
  takeOver(): Promise<void>;
  reload(): Promise<void>;
};

export function useCareTimeline(api: BabyCareApi): {
  items: CareTimelineItemDto[];
  nextCursor: string | null;
  loading: boolean;
  message: string | null;
  setCategory(value: CareTimelineCategory): void;
  setWindow(from: string, to: string): void;
  loadMore(): Promise<void>;
};
```

**Produces flow:**

```text
护理状态
-> 交接摘要 / 我来接手
-> fixed interval facts and actor attribution
-> summary fact link
-> filtered typed timeline
-> next cursor page
```

- [ ] **Step 1: Write takeover/briefing RED Web tests**

Assert `我来接手` sends one stable request ID, double-click disables duplicate submit, 24-hour fallback is visibly labeled, checkpoint briefing remains fixed after refresh, and API failure shows retry without disabling quick recording.

- [ ] **Step 2: Write timeline RED Web tests**

Render every payload family. Assert actual time, actor/source, backfill marker, type-specific summary, filters, summary-to-window navigation, cursor continuation, and no bottle capacity presented as intake.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-handoff-timeline.test.tsx
```

- [ ] **Step 4: Implement hooks with independent state**

`useHandoff` and `useCareTimeline` do not share quick-record `busy`. Failed briefing/timeline reads cannot disable `FeedingForm`, `DiaperForm`, or `SleepControls`.

- [ ] **Step 5: Implement focused accessible components**

Use explicit button/link names, `aria-live="polite"` for noncritical status, and stable section labels. Add no animation or audio.

- [ ] **Step 6: Run GREEN and existing Web regression**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-handoff-timeline.test.tsx test/care-workspace.test.tsx test/care-workspace-advanced.test.tsx test/App.test.tsx
pnpm typecheck
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/care/HandoffPanel.tsx apps/web/src/care/CareTimeline.tsx apps/web/src/care/CareTimelineCard.tsx apps/web/src/care/useHandoff.ts apps/web/src/care/useCareTimeline.ts apps/web/src/care/CareWorkspace.tsx apps/web/src/api-client.ts apps/web/src/auth/AuthenticatedShell.tsx apps/web/src/app.css apps/web/test/care-handoff-timeline.test.tsx
git commit -m "feat: add handoff and typed care timeline UI"
```

---

### Task 6: Full Historical Detail, Editing, Undo, and Revision UI

**Files:**
- Create: `apps/web/src/care/CareEventDetail.tsx`, `CareEventEditForm.tsx`, `CareRevisionHistory.tsx`
- Modify: `apps/web/src/care/CareTimeline.tsx`, `RecentEditPanel.tsx`, `CareWorkspace.tsx`
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/app.css`
- Test: `apps/web/test/care-history-correction.test.tsx`

**Consumes:** event detail, versioned update/undo, and revision history APIs from Tasks 2 and 4.

**Produces:** one detail-driven correction path for recent and older records. Recent `修改` opens the same editor instead of maintaining a partial time-only implementation.

- [ ] **Step 1: Write full-detail RED tests**

Assert feeding components/actual ml, diaper detail, sleep start/end, care actions, measurements, medication facts, actor/source, version, and note render without recommendation language.

- [ ] **Step 2: Write correction RED tests**

Cover formula amount/time, diaper kind/detail, sleep interval, medication administered facts, older-record undo confirmation, successful version advance, stale conflict refresh, and preserved typed draft.

```ts
expect(api.editCareEvent).toHaveBeenCalledWith(eventId, {
  expectedVersion: 2,
  event: expect.objectContaining({ eventType: 'feeding' }),
});
```

- [ ] **Step 3: Write revision-history RED tests**

Assert actor, time, edit/void label, versions, and type-aware before/after values. Do not render raw JSON blocks to caregivers.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-history-correction.test.tsx
```

- [ ] **Step 5: Implement discriminated edit fields**

Use M2 meanings and validation. Medication exposes only name, dose, unit, actual time, and note. Add no advice fields.

- [ ] **Step 6: Remove partial recent-only divergence**

Keep `RecentEditPanel.tsx` as a thin adapter to `CareEventEditForm`, or remove it in the same commit if no imports remain. Confirm with:

```bash
rg -n "RecentEditPanel" apps/web/src apps/web/test
```

- [ ] **Step 7: Run GREEN and Web regression**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-history-correction.test.tsx test/care-handoff-timeline.test.tsx test/care-workspace-advanced.test.tsx
pnpm lint
pnpm typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/care apps/web/src/api-client.ts apps/web/src/app.css apps/web/test/care-history-correction.test.tsx
git commit -m "feat: add complete care history correction UI"
```

---

### Task 7: Day/Night Display and Non-Authoritative Reminder UI

**Files:**
- Create: `apps/web/src/care/CareDisplayMode.tsx`, `useCareDisplayMode.ts`
- Create: `apps/web/src/care/HandoffReminderSettings.tsx`
- Modify: `apps/web/src/care/HandoffPanel.tsx`, `CareWorkspace.tsx`
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/app.css`
- Test: `apps/web/test/care-day-night-reminders.test.tsx`

**Consumes:** reminder GET/PUT routes from Task 3.

**Produces:**

```ts
export type CareDisplayMode = 'auto' | 'day' | 'night';
export const CARE_DISPLAY_MODE_KEY = 'baby-care.display-mode.v1';
```

Auto uses `matchMedia('(prefers-color-scheme: dark)')`. Manual mode sets `data-care-theme="day|night"` on `document.documentElement`. Preference stays local to the browser.

- [ ] **Step 1: Write display-mode RED tests**

Assert auto follows media changes, manual override persists/reloads from the exact key, invalid storage falls back to auto, and night selection does not hide warning/dialog text.

- [ ] **Step 2: Write reminder RED tests**

Assert current caregiver can configure at most eight rules, a visible prompt offers `我来接手`, dismissing creates no checkpoint, and only takeover calls `createHandoff`.

- [ ] **Step 3: Write low-disturbance assertions**

Assert no `<audio>`, no `HTMLMediaElement.play`, success uses `aria-live="polite"`, warnings remain visible, and `prefers-reduced-motion` disables nonessential transitions.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @baby-care/web exec vitest run test/care-day-night-reminders.test.tsx
```

- [ ] **Step 5: Implement theme tokens and reminder settings**

Use CSS custom properties for surface/text/border/accent. Preserve minimum 44px controls and current responsive behavior.

- [ ] **Step 6: Run GREEN and full Web suite**

```bash
pnpm --filter @baby-care/web test
pnpm lint
pnpm typecheck
pnpm build
```

- [ ] **Step 7: Commit and exact-head CI**

```bash
git add apps/web/src/care/CareDisplayMode.tsx apps/web/src/care/useCareDisplayMode.ts apps/web/src/care/HandoffReminderSettings.tsx apps/web/src/care/HandoffPanel.tsx apps/web/src/care/CareWorkspace.tsx apps/web/src/api-client.ts apps/web/src/app.css apps/web/test/care-day-night-reminders.test.tsx
git commit -m "feat: add low-disturbance care workspace modes"
git push
```

Require five-job CI green before system integration closure.

---

### Task 8: Cross-Caregiver Closed-Loop, Privacy, and Regression Gate

**Files:**
- Create: `apps/api/test/care-workspace-system.integration.test.ts`
- Modify: `apps/api/test/care-concurrency.integration.test.ts`, `apps/api/test/audit.integration.test.ts`
- Modify only for defects reproduced by these tests: focused files under `apps/api/src/care/`, `apps/api/src/routes/`, `apps/web/src/care/`

- [ ] **Step 1: Write closed-loop integration test**

```text
Dad takeover
-> Dad formula 60ml in 150ml bottle
-> Nanny diaper + medication fact
-> Dad briefing shows factual interval and attribution
-> Dad edits formula 60->65 with expected version
-> old briefing recomputes to 65 without changing its time window
-> Nanny takeover sees corrected facts
-> stale Dad undo is rejected
```

- [ ] **Step 2: Add isolation and reminder invariants**

Assert cross-family checkpoint/timeline/detail/history access returns the same non-leaking denial shape, disabled Nanny is rejected, and reminder reads/writes never change checkpoint count.

- [ ] **Step 3: Add privacy assertions**

Search audit metadata and compact diagnostic fixtures for absence of care payloads and secrets. Allow IDs, event types, action/status codes, trace IDs, and timings only.

- [ ] **Step 4: Run focused RED then GREEN**

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api exec vitest run test/care-workspace-system.integration.test.ts test/care-concurrency.integration.test.ts test/audit.integration.test.ts
```

Fix only a reproduced specification violation or regression.

- [ ] **Step 5: Run complete non-Compose gate**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

- [ ] **Step 6: Commit only proven changes**

```bash
git add apps/api/test/care-workspace-system.integration.test.ts apps/api/test/care-concurrency.integration.test.ts apps/api/test/audit.integration.test.ts
git diff --cached --stat
git commit -m "test: close M3 caregiver workspace loop"
```

If implementation files contain a proven fix, stage those exact paths explicitly before commit. Never stage unrelated changes.

---

### Task 9: Production Compose, Project State, and Exact-Head Gate

**Files:**
- Modify: `scripts/compose-smoke.mjs`, `README.md`, `docs/PLAN.md`
- Modify: `.agent/current-milestone.json`, `summary.md`
- Modify only for reproduced production defects: `compose.yaml`, `infra/docker/*`, `.github/workflows/ci.yml`

- [ ] **Step 1: Extend production empty-DB smoke**

Preserve M1/M2 assertions, update M2 edit/undo requests to carry expected version, then add:

```text
Dad explicit takeover
-> fallback briefing labeled recent 24h
-> Dad formula 60ml with bottle capacity 150ml
-> Nanny diaper and factual medication event
-> Nanny explicit takeover
-> checkpoint briefing proves actual 60ml, capacity exclusion, actor attribution
-> typed cursor timeline/detail
-> Dad edit 60->65 with expected version
-> fixed briefing recomputes to 65
-> stale undo returns care_state_conflict
-> revision history proves actor/version
-> reminder configuration changes no checkpoint rows
```

- [ ] **Step 2: Run disposable production Compose gate**

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down -v --remove-orphans
```

Expected final markers: `SMOKE_OK component=m3-handoff`, `m3-typed-timeline`, `m3-revision-conflict`, `m3-care-workspace-release-flow`.

- [ ] **Step 3: Update durable project state after evidence exists**

- `README.md`: document only operational M3 behavior.
- `docs/PLAN.md`: mark M3 complete only after focused Compose passes.
- `.agent/current-milestone.json`: record branch and verified code head only after the SHA exists; leave CI run unset until success.
- `summary.md`: add durable architecture/capability conclusions without transient task logs.

- [ ] **Step 4: Pre-final scope and secret review**

```bash
git status -sb
git diff --check
git diff --stat
rg -n "left breast|right breast|recommended dose|calculate dose|camera audio|wake word|ASR|TTS|JoyAI|Qwen|Ollama" apps packages migrations
rg -n "github_pat_|ghp_|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY" . --glob '!pnpm-lock.yaml' --glob '!docs/superpowers/plans/**'
```

Expected: no scope-leak implementation and no credential material. Documentation may mention excluded technologies only as explicit boundary text.

- [ ] **Step 5: Commit release state and push**

After explicit remote-operation authorization:

```bash
git add scripts/compose-smoke.mjs README.md docs/PLAN.md .agent/current-milestone.json summary.md
git commit -m "test: close M3 care workspace release gate"
git push
```

- [ ] **Step 6: Run exact-final-head CI**

Require one final commit SHA for:

```text
static                   PASS
unit/contracts           PASS
PostgreSQL integration   PASS
production build         PASS
production Compose smoke PASS
```

On failure, inspect compact diagnostics first, reproduce with the focused command, fix on the feature branch, rerun, commit, push, and require a fresh run on the new head.

- [ ] **Step 7: Record evidence without invalidating exact head**

Adding a run ID after successful CI creates a new head. Record the authoritative run in the Draft PR description and handoff report. In-repo status records verified code head and five-gate requirement without claiming a run that predates later file changes.

- [ ] **Step 8: Final verification and Draft PR**

Invoke `superpowers:verification-before-completion`. Compare final branch with `c31ee42`, confirm only M3/spec/status changes, and open/update a Draft PR:

```text
head: codex/m3-care-workspace-implementation
base: codex/m2-care-recording-implementation
state: Draft
```

Do not merge either PR and do not modify `main`.

---

## Completion Report Contract

The executing session reports:

1. final branch and exact HEAD;
2. commits/tasks completed;
3. focused test evidence per task;
4. final five-job CI run and conclusions;
5. production Compose markers;
6. changed project-state files;
7. remaining risks or human acceptance needs;
8. Draft PR URL and base/head;
9. explicit confirmation that `main` was not modified or merged.
