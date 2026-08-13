# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. M2 uses the approved design and reviewed implementation plan under `docs/superpowers/`.

## Current state

Current milestone: **M2 — Care Recording MVP — implementation in progress**  
Previous milestone: **M1 — Family and baby foundation — verified complete**

Verified M1 production baseline:

- `codex/m1-family-baby-foundation @ 76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`
- CI `31707486985` — static/unit/integration/build/compose-smoke 5/5 PASS
- M1-H blocker: closed

M2 sources:

- design: `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`
- reviewed plan: `docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`
- branch: `codex/m2-care-recording-implementation`

## M2 progress

### Task 1 — Care foundation schema, contracts, authorization — COMPLETE

- head: `7c44d480e588b42bced8da0ee9be4ac3a2bccabd`
- CI `31713732247` — 5/5 PASS
- typed event envelope/child tables, ownership/check constraints, M2 runtime migration, strict common contracts and caregiver care permissions

### Task 2 — Deterministic care rules — COMPLETE

- head: `c44a793d601df303a62e07fed5ff551e97a87721`
- CI `31715074111` — 5/5 PASS
- recent-20 quick-value ranking
- five-minute future timestamp tolerance and old-backfill warning
- deterministic possible-duplicate warning
- median-based unusual recorded-value warning

### Task 3 — Authenticated ownership, idempotency, revision primitives — CURRENT

Scope:

- derive family/baby/actor/membership exclusively from authenticated M1 session
- preserve caregiver policy and Origin guard
- invalidate disabled caregiver sessions immediately
- idempotent manual care creation by actor/family/clientRequestId
- active-event row locking, append-only revision history, void primitive
- privacy-safe care audit metadata only

Following tasks remain per the reviewed implementation plan.

## Known tooling note

`0001_m2_care_recording.sql` and the migration journal are runtime-verified by PostgreSQL and Compose. The current harness could not safely run Drizzle Kit to produce the matching `0001_snapshot.json`. Do not make later schema changes until snapshot metadata is reconciled; close this tooling note before final M2 release.

## Hard scope boundaries

No Guardian ingestion, JoyAI/Qwen, automated feeding recognition, M3 handoff UX, diagnosis/dose recommendation, cloud deployment, or `main` modification/merge in M2.

## Working rule

Execute independent RED -> GREEN -> exact-head CI segments. Persist completed tasks in Git before moving on. Use compact diagnostics before raw logs.
