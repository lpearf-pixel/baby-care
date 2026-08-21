# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. Detailed design and implementation history live under `docs/superpowers/`.

## Current state

Current milestone: **M4 — Birth Ready Operations and Data Safety — Task 7 complete**
Completed milestone: **M3 — Care Workspace — verified complete**
Previous milestone: **M2 — Care Recording MVP — verified complete**

Verified M1 production baseline:

- `codex/m1-family-baby-foundation @ 76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`
- CI `31707486985` — static/unit/integration/build/compose-smoke 5/5 PASS
- M1-H blocker: closed

M2 sources:

- design: `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`
- reviewed plan: `docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`
- implementation branch: `codex/m2-care-recording-implementation`
- release-gate branch: `codex/m2-task11-release-gate`

M3 sources:

- approved design: `docs/superpowers/specs/2026-08-15-m3-care-workspace-design.md`
- implementation plan: `docs/superpowers/plans/2026-08-16-m3-care-workspace-implementation.md`
- implementation branch: `codex/m3-care-workspace-implementation`

M4 sources:

- approved design: `docs/superpowers/specs/2026-08-17-m4-birth-ready-operations-data-safety-design.md`
- design/implementation branch: `codex/m4-birth-ready-operations`
- implementation plan: `docs/superpowers/plans/2026-08-17-m4-birth-ready-operations-data-safety.md`

## M2 delivered

- Care event foundation with server-derived family/baby/actor ownership, idempotency, append-only revisions, void-based undo, and privacy-safe audit metadata.
- Bottle feeding records actual consumed ml separately from bottle capacity; expressed breast milk and formula are distinct; direct breastfeeding records total minutes only.
- Deterministic bottle quick values from the latest 20 real records per liquid type, showing at most three values.
- Detailed diaper recording and sleep start/wake with now, 10/20/30-minute, and custom backfill support.
- Burping, spit-up, crying, bathing, temperature, weight, and medication-as-administered fact recording; no medication recommendation or dose calculation.
- Soft confirmation for possible duplicates, unusual values, old backfill, and sleep overlap; explicit confirmation never silently normalizes data.
- Rolling 24h summary, active timeline, recent edit/undo, and caregiver attribution across Dad/Mom/Nanny.
- Responsive Web/PWA fast-care workspace with draft preservation on save failure.
- Compact CI diagnostics redact care values and session/setup secrets before bounded evidence is emitted.
- PostgreSQL runtime migration plus matching Drizzle `0001_snapshot.json` metadata.
- Production-mode empty-DB Docker Compose smoke extends the M1 family/auth flow through M2 feeding, diaper, sleep, summary, edit/undo, and Nanny attribution.

## M2 segmented verification

- Task 1: `7c44d480e588b42bced8da0ee9be4ac3a2bccabd`, CI `31713732247` — 5/5 PASS
- Task 2: `c44a793d601df303a62e07fed5ff551e97a87721`, CI `31715074111` — 5/5 PASS
- Task 3: `d1f1680d247042a7125eb175a7dc5114b9729357`, CI `31716114837` — 5/5 PASS
- Task 4: `01200245`, CI `31761310208` — 5/5 PASS
- Task 5: `570c637c`, CI `31761850868` — 5/5 PASS
- Task 6: `4c63bc7c`, CI `31762144756` — 5/5 PASS
- Task 7: `9bd9a56c`, CI `31763051007` — 5/5 PASS
- Task 8: `92daa126`, CI `31763509841` — 5/5 PASS
- Task 9: `610df76f`, CI `31764213858` — 5/5 PASS
- Task 10: `98618789`, CI `31764611302` — 5/5 PASS
- Task 11 focused production flow: CI `31764744900` — production Compose M2 flow PASS before final metadata/docs closure.

A fresh five-job CI on the exact final M2 head remains the authoritative release evidence and must include this file, `.agent/current-milestone.json`, README, migration metadata, and production smoke.

## M3 verified release scope

The M3 branch implements explicit caregiver takeover, recent-24-hour fallback and fixed checkpoint briefings, typed/filterable cursor timeline and event detail, version-aware historical correction with append-only history, caregiver-scoped non-authoritative reminders, and per-device low-disturbance day/night Web behavior.

Authoritative M3 release evidence:

- final exact-head candidate: `52b042a66122464af338a2b4931315d92dff0965`;
- CI run `31959895049`: static, unit/contracts, PostgreSQL integration, production build, and production Compose smoke — 5/5 PASS;
- production Compose job `95196165456` preserved the M1/M2 assertions and emitted exactly these four M3 markers:

- `SMOKE_OK component=m3-handoff`
- `SMOKE_OK component=m3-typed-timeline`
- `SMOKE_OK component=m3-revision-conflict`
- `SMOKE_OK component=m3-care-workspace-release-flow`

M3 is verified complete on that matched final code-head/run pair. PR #5 remains Draft
for human review and must not be merged without explicit approval.

## M4 approved scope

M4 closes Birth Ready operations and data safety without depending on Guardian. It adds
Dad/Mom-only private family export, private atomic PostgreSQL backup, fail-closed restore
to an explicitly empty isolated database, and a synthetic Dad/Mom/Nanny operational
simulation that proves the restored care timeline, revisions, handoffs and attribution.

The design and task-level RED-GREEN plan were approved on 2026-08-17. Task 1 is complete
at `5d204bd`: strict family-export v1 contracts, export capability/errors, deterministic
ordering helpers, and the centralized 32 MiB startup bound are implemented and reviewed.
Task 2 is complete at `6d5a166`: a family-scoped export buffer is assembled through one
`REPEATABLE READ READ ONLY` client with ten fixed set-oriented reads, strict typed and
revision-causality validation, deterministic UTF-8 serialization, and a closed byte
limit. Independent review approved with no findings. The two PostgreSQL integration
cases remain enabled but were skipped locally because `TEST_DATABASE_URL` is absent.
Task 3 is complete through `98de9fc`: authenticated Dad/Mom-only export, per-actor
concurrency, private headers and fail-closed audit behavior are reviewed. Task 4 is
complete through `40aa49a`: the bounded Dad/Mom Web download surface is independently
reviewed, with Nanny absence and non-preview/cleanup/retry privacy regressions proven.
Task 5 is complete through `df43b93`: strict private backup creation/verification,
kernel-enforced no-replace publication and preservation-first native failure handling are
independently reviewed. Fresh Node 24 evidence is 67 operations tests with typecheck,
lint, production build and offline frozen-lock passing. Task 6 is complete at `de09494`:
verified bundles restore only to a distinct empty PG16 target, fixed read-only invariants
run before transactional restored-session revocation, and the existing API read models
plus fresh login are proven against generated restored data. Fresh evidence is 87
operations tests, 5/5 real dual-PG16 restore cases, full workspace tests/typecheck/lint/
build and independent review with no Critical/Important findings. Task 7 is complete at
`5b92477`: four guarded operator commands, fixed PostgreSQL 16 Compose adapters, bounded
subprocess cleanup and disposable isolated restore practice passed 130 focused tests,
one real generated-data Compose flow, full lint/typecheck/build/privacy gates and an
independent review with no Critical/Important findings. The next executable slice is
Task 8, synthetic Birth Ready operations simulation and privacy gate.
M3 implementation scope must not be reopened implicitly.

## Hard scope boundaries

M4 contains no Guardian ingestion, voice/audio runtime, JoyAI/Qwen runtime, automated
feeding recognition, full offline synchronization, diagnosis/dose recommendation,
cloud deployment, in-place production restore, automatic backup deletion, or `main`
modification/merge. Those remain separate future decisions.

## Working rule

For subsequent milestones, keep RED -> GREEN -> exact-head CI segments, persist progress in Git, and use compact diagnostics before raw logs.
