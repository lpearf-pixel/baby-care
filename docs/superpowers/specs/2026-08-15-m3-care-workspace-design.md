# M3 Care Workspace Design

Status: approved design
Date: 2026-08-15
Repository: `lpearf-pixel/baby-care`
Target branch: `codex/m2-care-recording-implementation`

## 1. Purpose

M3 turns the M2 recording surface into an operational care workspace for Dad, Mom, and Nanny. It improves comprehension of the current state, caregiver handoff, the full care timeline, correction history, and day/night use without changing the approved M2 care semantics.

M3 remains useful without Baby Guardian or the future voice runtime. It also establishes stable Baby Care contracts that a later local Voice Care Gateway can call without making camera audio, speech recognition, or model inference part of this milestone.

## 2. Verified M2 baseline

M3 builds on these existing M2 capabilities:

- authenticated Dad/Mom/Nanny care writes with server-derived family, baby, actor, and source;
- typed feeding, diaper, sleep, common-care, measurement, and medication-as-administered records;
- rolling 24-hour care summary and current sleep state;
- dynamic bottle quick values learned from actual recent intake;
- append-only revisions and void-based undo;
- warning confirmation, idempotent create operations, and draft preservation on ordinary save failure;
- a generic care timeline query whose current envelope does not yet expose type-specific display facts;
- correction UI limited to the most recently saved record.

The M2 meanings remain fixed. Bottle capacity is never intake, expressed breast milk and formula remain distinct, direct breastfeeding remains duration-only, and medication remains a factual record with no recommendation or dose calculation.

## 3. Goals

M3 must provide:

1. an explicit, schedule-independent caregiver takeover checkpoint;
2. a handoff summary derived from authoritative care records;
3. optional fixed-time reminders that never create handoff facts;
4. a comprehensible, cursor-paginated timeline with typed event details;
5. detail, edit, undo, and revision-history access for older records;
6. optimistic concurrency protection against stale edits;
7. low-disturbance day/night Web/PWA operation;
8. clear service boundaries for later voice-first care interaction.

Common recording actions must retain the M2 target of roughly two to three taps.

## 4. Explicit non-goals

M3 does not add:

- Xiaomi camera audio capture;
- wake-word detection, ASR, TTS, speaker-volume control, or transcript storage;
- Guardian event ingestion or automated care-event recognition;
- JoyAI, Qwen, Ollama, or another AI runtime;
- medical diagnosis, risk scoring, medication advice, or dose recommendation;
- automatic creation of a handoff from a schedule, actor change, camera observation, or model inference;
- a full staff roster, payroll, or shift-management system;
- a configurable milk amount that is silently written as actual intake;
- full offline synchronization or cloud deployment.

The future Voice Care feature may offer a configured milk amount as a suggestion, but actual intake becomes authoritative only after explicit voice or screen confirmation.

## 5. Considered handoff approaches

### 5.1 Chosen: explicit takeover checkpoint plus derived summary

The incoming caregiver selects `我来接手`. Baby Care records an attributable checkpoint and derives the summary between the previous checkpoint and the current one.

This supports both irregular handoffs and mostly regular schedules with occasional changes. It is auditable, voice-ready, and does not require the outgoing caregiver to complete a paired action.

### 5.2 Rejected: infer handoff from actor changes

The first record from a different caregiver could be treated as a handoff. This removes a tap but is ambiguous when caregivers alternate, record remotely, or backfill older events.

### 5.3 Rejected: full recurring shift model

A roster with recurring shifts and exception dates is more powerful but encodes care habits that are not yet stable and adds unnecessary Birth Ready complexity.

## 6. Handoff product behavior

### 6.1 Takeover action

The workspace exposes a prominent `我来接手` action.

- Only the incoming caregiver action is required.
- The outgoing caregiver does not need to create a matching `交班` record.
- The create request carries a `clientRequestId`; family, baby, actor, and source come from authenticated server context.
- The effective checkpoint time is supplied as an offset-aware timestamp so a deliberate backfill can be represented; normal UI use defaults to now.
- The server applies the existing future-time validation policy and keeps the server creation time separately.
- Repeated submission with the same actor and `clientRequestId` returns the original result.

### 6.2 Handoff summary window

The handoff-briefing window starts at the previous active checkpoint and ends at the newly created checkpoint's effective time. That end time is returned as `asOf` and remains fixed when the briefing is reopened. If no previous checkpoint exists, the window is the preceding 24 hours ending at the new checkpoint and the UI labels it `最近24小时` rather than implying a historical handoff boundary. The ordinary current-care panel remains a separate query whose `asOf` advances with the current view.

The summary includes only recorded facts:

- last feeding and elapsed time;
- last diaper and elapsed time;
- current sleep state;
- interval feeding totals, keeping bottle ml and breastfeeding sessions/minutes separate;
- interval diaper counts and recorded sleep intervals;
- medication administrations, temperature measurements, spit-up, and other explicitly recorded care facts;
- actor attribution for activity in the interval;
- edits and voids that affect records in the interval.

The summary does not diagnose, prioritize medical risk, or invent missing values. Each aggregate or notable fact links to the corresponding filtered timeline interval.

### 6.3 Optional regular-time reminders

M3 stores lightweight, optional on-screen reminder rules by caregiver membership, family timezone, weekday set, and local time.

- No reminder rule is created by default.
- A reminder is only a prompt to review the workspace or select `我来接手`.
- A reminder never creates or edits a handoff checkpoint.
- M3 does not require operating-system push notifications; an in-app banner while the PWA is open is sufficient.
- A temporary or late handoff simply creates a checkpoint at the real effective time and requires no schedule exception object.

## 7. Full care timeline

### 7.1 Timeline presentation

The timeline is ordered by actual care time descending and grouped by family-local calendar date. Each item displays:

- event type and type-specific factual summary;
- actual occurrence time;
- actor display name;
- source: manual, AI, device, Guardian, or import where applicable;
- a backfill marker when creation is more than five minutes after the actual occurrence time;
- active or voided state where history is intentionally displayed.

The initial filters are deliberately small: all, feeding, diaper, sleep, and other. Actor and source remain visible but do not require dedicated filters in the first M3 slice.

### 7.2 Typed response

The existing generic envelope is extended with a discriminated, type-specific payload rather than a free-form JSON object. The common item includes:

- `id`, `eventType`, `occurredAt`, `createdAt`, and `updatedAt`;
- `status`, `source`, `actorUserId`, and `actorDisplayName`;
- `version`;
- optional note according to the existing privacy boundary;
- one payload variant matching the event type.

Payloads reuse the validated M2 field meanings. Timeline reads must not expose a bottle capacity as intake or infer breastfeeding milliliters.

### 7.3 Pagination

The client uses an opaque cursor encoding the stable ordering tuple `(occurred_at, created_at, id)`. The API returns `nextCursor` or null. This prevents gaps or duplicates when multiple caregivers record events with the same care time.

The client does not fetch the entire history to render the workspace.

## 8. Detail, correction, undo, and revision history

Any authorized active timeline record can open a detail surface with its complete typed facts, actor/source metadata, and current version.

- Recent records retain the existing fast edit and undo actions.
- Older records require opening detail before edit or undo.
- Undo of an older record requires explicit confirmation.
- Edit remains append-only: the original snapshot and new snapshot are recorded in the revision history.
- Undo remains a void operation and never physically deletes the care fact or its audit history.
- Revision history shows action, revision actor, timestamp, version, and a type-aware before/after difference.

Edit and undo requests carry `expectedVersion`. The write succeeds only when it matches the current active record version. A stale request returns a stable conflict error; the UI reloads the latest version and asks the caregiver to review instead of silently overwriting another caregiver's correction.

## 9. Day and night operation

The Web/PWA exposes `auto`, `day`, and `night` display modes.

- `auto` follows the device color-scheme preference.
- A manual override is stored per browser/device and does not silently change another caregiver's device.
- Night mode reduces large bright surfaces, avoids nonessential animation and flashing transitions, and keeps text and warnings legible.
- Primary controls retain large touch targets and the same short interaction paths.
- Successful saves use a low-disturbance visual status and do not play Web audio.
- Safety-relevant warnings and medication facts are never hidden or visually de-emphasized below ordinary readability.

Voice response volume is outside the Web runtime. A later `baby-monitor-local` Voice Care Gateway will implement quiet hours, brief acknowledgements, low TTS volume, or visual-only acknowledgement. Baby Care will remain the authority for confirmed care records and may later expose dashboard-editable voice policy without changing M3 record semantics.

## 10. Architecture and component boundaries

M3 follows the existing contracts/domain/API/Web layering and avoids a broad rewrite.

### 10.1 Web

`CareWorkspace` remains the page-level coordinator but delegates to focused units:

- `CurrentCareState` for the existing summary;
- `HandoffPanel` for takeover and the derived summary;
- `CareTimeline` and type-specific timeline cards;
- `CareEventDetail` for full facts and actions;
- `CareRevisionHistory` for attributable before/after changes;
- `CareDisplayMode` for per-device day/night selection.

Recording forms continue to own their existing drafts and warning-confirmation behavior.

### 10.2 Contracts and domain

Add focused schemas for:

- handoff create input and receipt;
- handoff summary and optional reminder rules;
- typed timeline items and cursor responses;
- care-event detail and revision-history responses;
- version-aware edit and undo requests.

Domain utilities own deterministic date grouping, elapsed labels, backfill classification, and reminder visibility. Medical interpretation does not enter the domain layer.

### 10.3 API and persistence

Add focused handoff route/service/repository modules and extend the existing query and revision modules rather than creating an oversized workspace service.

`care_handoff_checkpoints` stores stable checkpoint facts, including family, baby, actor, source, effective time, creation time, idempotency key, and trace ID. Optional reminder rules are separate configuration and are never joined into the authoritative checkpoint sequence as facts.

Handoff summaries and timelines are read models derived from PostgreSQL source-of-truth records. Queries must avoid per-item N+1 fetches by loading type-specific details in bounded batches or equivalent set-based queries.

## 11. Data flow

The primary takeover flow is:

```text
Web `我来接手`
-> authenticated handoff API
-> idempotent checkpoint write
-> previous-checkpoint lookup
-> one server-anchored summary query
-> summary response with timeline interval links
```

The future voice flow uses the same service semantics:

```text
local Voice Care Gateway
-> authenticated Baby Care adapter
-> existing typed care/handoff contract
-> explicit confirmation where required
-> authoritative PostgreSQL record
```

M3 does not implement the second flow's transport, credentials, wake word, audio capture, or model runtime.

## 12. Authorization, privacy, and diagnostics

- Server-side M1 authorization remains authoritative for every read and write.
- A client cannot choose another actor, family, baby, or unrestricted source.
- Handoff, timeline, detail, and revision queries are family/baby scoped.
- Care notes, milk amounts, medication details, temperatures, and revision snapshots are not written to compact diagnostics.
- Diagnostics use bounded event IDs, event types, status/error codes, trace IDs, and timing metadata.
- M3 stores no audio, camera frames, or voice transcript.

## 13. Error handling

- Timeline or handoff-summary read failure does not disable quick recording.
- Missing data produces an explicit empty state, never a fabricated value.
- Ordinary save failure retains the current form draft and idempotency key.
- Duplicate takeover submission returns the existing checkpoint.
- A stale edit or undo returns a conflict and cannot overwrite the latest version.
- Invalid or expired cursors return a stable validation response and permit restarting from the newest page.
- A record voided between detail load and action returns a stable not-found/state-conflict response.
- Existing care warnings remain explicit confirmation flows and never silently normalize input.
- Authentication and authorization failures do not leak whether another family's record exists.

## 14. Testing strategy

### 14.1 Contracts and domain

Cover:

- strict discriminated timeline payloads for every care event type;
- opaque cursor round-trip and stable ordering;
- backfill classification at the five-minute boundary;
- reminder visibility in the family timezone;
- confirmation that reminder rules never create checkpoints;
- preservation of all M2 care semantics in derived summaries.

### 14.2 PostgreSQL integration

Cover:

- authenticated handoff ownership and cross-family isolation;
- idempotent checkpoint creation;
- no-previous-checkpoint 24-hour fallback;
- exact handoff interval boundaries;
- correction and void effects on a newly derived handoff summary;
- cursor pagination with identical event timestamps;
- typed event detail loading;
- revision-history attribution;
- stale edit/undo conflict behavior;
- concurrent caregiver reads and writes without lost attribution.

### 14.3 Web

Cover:

- takeover and summary comprehension;
- direct navigation from summary facts to the correct timeline interval;
- timeline filters, paging, typed cards, actor/source, and backfill markers;
- historical detail, edit, undo confirmation, and revision history;
- draft preservation and independent read-error recovery;
- `auto`, `day`, and `night` display modes;
- large touch targets and two-to-three-tap common recording paths;
- no Web sound or bright flashing success behavior in night mode.

### 14.4 Delivery gates

Each implementation slice follows RED -> GREEN -> exact-head CI. The milestone gate includes static checks, unit tests, Web tests, PostgreSQL integration, production build, and a production Compose flow covering login, takeover, interval summary, timeline, historical edit, conflict handling, undo, and Nanny attribution.

## 15. Definition of Done

M3 is complete only when:

- explicit takeover works for irregular and mostly regular handoffs without requiring a paired outgoing action;
- optional reminders remain non-authoritative;
- handoff summaries are derived from current authoritative records and update after corrections;
- the typed, paginated timeline exposes accurate care facts and attribution;
- authorized older records support detail, edit, undo, and revision history;
- stale edits cannot silently overwrite a newer version;
- day/night Web operation is low-disturbance without hiding important facts;
- M2 semantics and fast recording paths remain intact;
- no audio, AI runtime, Guardian ingestion, or medical-advice scope leaks into M3;
- focused tests and the full exact-head delivery gate pass;
- the implementation plan and project status documents match the verified repository state.
