# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. This file is the compact execution index; detailed milestone designs/plans live under `docs/superpowers/`.

## Current state

Current milestone: **M2 — Care Recording MVP — implementation plan written, pending user review**  
Previous milestone: **M1 — Family and baby foundation — verified complete**

Verified production baseline:

- authoritative M1 branch: `codex/m1-family-baby-foundation`
- authoritative M1 HEAD: `76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`
- authoritative CI run: `31707486985` — static/unit/integration/build/compose-smoke 5/5 PASS
- M1-H production closure: complete

M2 design and the real-family care-habits input gate are complete. The approved product design is preserved unchanged from `codex/m2-care-recording-mvp @ eadb8f1d41770b5ef940f16993e57a4cb8ee6bc5` on the implementation branch.

M2 implementation branch:

`codex/m2-care-recording-implementation`

Authoritative reviewed implementation plan:

`docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`

No M2 production code starts until this implementation plan is approved.

## Product goal

Deliver a practical Web/PWA newborn-care workspace that Dad, Mom, and Nanny can use on iPhone, Android, and Mac before Birth Ready.

The product should make four things easy:

1. See the baby's current care state immediately.
2. Record common care actions in about 2-3 taps.
3. Share one synchronized source of truth across caregivers.
4. Understand the previous rolling 24 hours and caregiver handoff without reading the entire timeline.

Baby Care must remain useful when Baby Guardian is offline.

## Architecture boundary

```text
iPhone / Android / Mac
        |
        v
   Baby Care Web/PWA
        |
        v
     Baby Care API
        |
   +----+-----------+
   |                |
PostgreSQL      backup/export
   |
   v
Unified Baby Timeline
   ^
   |
Guardian Adapter <-- versioned API/events --> baby-monitor-local
```

Guardian never writes directly to the Baby Care database.

The separate AI validation track remains non-blocking and outside M2:

```text
Xiaomi camera/sensors
  -> i9 OpenVINO / deterministic perception
  -> M2 Mac Baby Agent Orchestrator
  -> JoyAI semantic action
  -> Qwen3-VL ambiguity escalation
  -> semantic candidate
  -> Baby Care / human confirmation
```

## Milestones

### M0 — Repository and delivery foundation — COMPLETE

Verified:

- pnpm/TypeScript monorepo with frozen lockfile
- shared health/event contracts
- structured trace IDs and bounded diagnostics
- Fastify API with PostgreSQL-aware `/health`
- responsive React/Vite Web/PWA shell
- real PostgreSQL integration tests
- production API/Web container builds
- Docker Compose smoke
- segmented GitHub public-runner CI
- compact CI failure artifacts

### M1 — Family and baby foundation — COMPLETE

Verified:

- family model
- `xiangxiang` baby profile
- Dad/Mom/Nanny identities and roles
- family-test login/session flow
- authorization boundaries
- actor/source audit metadata
- migrate-before-listen production startup
- fail-closed startup lifecycle
- empty-database Docker Compose family authorization flow

### M2 — Care Recording MVP — PLAN WRITTEN / PENDING APPROVAL

Real-family care-habits gate: **satisfied**.

Approved design source:

`docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`

Reviewed implementation plan:

`docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`

Approved product scope includes:

- mixed feeding session
- expressed breast milk vs formula bottle records
- direct breastfeeding total-duration records
- dynamic recent actual bottle-volume shortcuts
- diaper/stool detail
- sleep start/wake/backfill
- burping
- spit-up
- crying
- bathing
- temperature
- weight
- medication administration facts
- fast edit/undo
- deterministic duplicate and sanity warnings
- rolling 24-hour bottle/breastfeeding summary support
- authenticated actor/source attribution for Dad/Mom/Nanny

Explicitly outside M2:

- Guardian ingestion
- JoyAI/Qwen runtime
- automated feeding recognition
- fixed Nanny shift schedule
- medication recommendation/dose calculation
- full offline synchronization
- M3 advanced handoff/timeline workspace

### M3 — Care workspace

- richer current-state Home
- unified timeline UX and filters
- caregiver handoff
- night/one-handed refinement
- broader operational summaries

### M4 — Reliability

- backup automation
- restore verification
- additional retry/weak-network hardening
- release-level diagnostics

### M5 — Guardian integration

- versioned Guardian event contract
- Guardian Adapter
- candidate ingestion
- confirm/ignore flow
- confidence/source display
- replayable CI fixtures

AI never silently overwrites human care facts.

### M6 — Baby Agent Orchestrator PoC — PARALLEL / NON-BLOCKING

- model registry
- Baby World State
- Care Session state machine
- L0/L1/L2 escalation
- JoyAI Mac feasibility benchmark
- Qwen3-VL fallback
- replayable action fixtures

### M7 — Birth Ready freeze

Once M0-M4 are stable and family simulation is usable:

- stop large feature additions
- fix usability/data/login/sync/backup/critical defects
- run full release gate
- produce `v0.1-rc`, then `v0.1 Birth Ready`

## Autonomous delivery workflow

```text
approved spec
 -> approved implementation plan
 -> segmented RED/GREEN implementation
 -> focused tests
 -> module/integration tests
 -> GitHub CI
 -> compact diagnostic evidence on failure
 -> automatic repair/rerun
 -> review
 -> exact-head milestone release gate
```

Ordinary software verification belongs on GitHub public runners, not on the user's local terminal.

## Context/token rule

Agents read the minimum evidence required for the current decision:

1. `agent.md`
2. this current-plan index
3. the relevant approved spec and reviewed implementation plan
4. affected contracts/symbols/diff
5. structured failure evidence
6. targeted raw-log ranges only if structured evidence is insufficient

## Next action

User reviews `docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`. After approval, execute it task-by-task on `codex/m2-care-recording-implementation`. Do not redesign care habits and do not start Guardian/JoyAI/Qwen work.
