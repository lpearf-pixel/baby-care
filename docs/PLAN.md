# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. Detailed M2 design and the reviewed implementation plan live under `docs/superpowers/`.

## Current state

Current milestone: **M2 — Care Recording MVP — implementation in progress**  
Previous milestone: **M1 — Family and baby foundation — verified complete**

Verified M1 production baseline:

- branch: `codex/m1-family-baby-foundation`
- HEAD: `76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`
- CI: `31707486985` — static/unit/integration/build/compose-smoke 5/5 PASS
- M1-H production blocker: closed

M2 sources:

- approved design: `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`
- reviewed implementation plan: `docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`
- implementation branch: `codex/m2-care-recording-implementation`

## M2 progress

### Task 1 — Care foundation schema, contracts, authorization — COMPLETE

Final verified head: `7c44d480e588b42bced8da0ee9be4ac3a2bccabd`  
CI: `31713732247` — 5/5 PASS

Delivered:

- typed `care_events` envelope and M2 child tables
- runtime migration `0001_m2_care_recording.sql`
- database ownership/check constraints
- strict common care write contracts
- care read/write capabilities for caregivers without expanding family-admin access
- privacy-safe care confirmation warning contract

### Task 2 — Deterministic care rules — CURRENT

Scope:

- recent-20 dynamic bottle quick values
- future timestamp tolerance and old-backfill soft warning
- deterministic duplicate candidate warning
- median-based unusual bottle amount warning

Following tasks remain per the reviewed implementation plan.

## Hard scope boundaries

Do not implement in M2:

- Guardian ingestion
- JoyAI/Qwen runtime
- automated feeding recognition
- M3 handoff/shift UX
- medical diagnosis or medication dose recommendation
- cloud deployment
- `main` changes or merge

## Working rule

Execute M2 in independently verified RED -> GREEN -> CI segments. Persist each completed task in Git/this plan before moving on. Use GitHub public runners for ordinary verification and compact diagnostics before raw logs.
