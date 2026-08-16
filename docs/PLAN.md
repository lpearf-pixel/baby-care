# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. Detailed design and implementation history live under `docs/superpowers/`.

## Current state

Current milestone: **M3 — Care Workspace — implementation in progress**
Completed milestone: **M2 — Care Recording MVP — implementation complete**  
Previous milestone: **M1 — Family and baby foundation — verified complete**

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

## Next milestone — M3 Care Workspace

M3 should improve timeline comprehension, handoff, correction workflows, and day/night operational UX using the M2 care facts already implemented. It must not silently expand into Guardian/JoyAI/Qwen integration; Guardian integration remains a later milestone.

## Hard scope boundaries

No Guardian ingestion, JoyAI/Qwen runtime, automated feeding recognition, diagnosis/dose recommendation, cloud deployment, or `main` modification/merge in M2.

## Working rule

For subsequent milestones, keep RED -> GREEN -> exact-head CI segments, persist progress in Git, and use compact diagnostics before raw logs.
