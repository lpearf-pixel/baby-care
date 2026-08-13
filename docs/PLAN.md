# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. This file is the compact execution index; detailed milestone designs/plans live under `docs/superpowers/`.

## Current state

Current milestone: **M2 — Care Recording MVP — ready for implementation planning**
Previous milestone: **M1 — Family and baby foundation — verified complete**

M1-H production closure is complete. The API now migrates before listening, fails closed
with database resources released when startup fails, and wires the full M1 family runtime
in production. The empty-database Docker Compose family authorization flow is verified.

M2 design and the real-family care-habits input gate were completed in the independent
`codex/m2-care-recording-mvp` work. M1-H no longer blocks M2 implementation planning;
the M2 care design remains authoritative on that branch and is not duplicated here.

M0 established:

- pnpm/TypeScript monorepo with frozen lockfile
- shared health/event contracts
- structured trace IDs and bounded diagnostics
- Fastify API with PostgreSQL-aware `/health`
- responsive React/Vite Web/PWA shell
- real PostgreSQL CI integration test
- production API/Web container builds
- Docker Compose stack and smoke probe
- segmented GitHub public-runner CI: static, unit, integration, build, compose-smoke
- compact CI failure artifacts that preserve bounded error-tail evidence
- minimal local startup/verification documentation

M0 implementation detail:

- Design: `docs/superpowers/specs/2026-08-13-m0-delivery-foundation-design.md`
- Plan: `docs/superpowers/plans/2026-08-13-m0-delivery-foundation.md`

## Product goal

Deliver a practical Web/PWA newborn-care workspace that Dad, Mom, and Nanny can use on iPhone, Android, and Mac before Birth Ready.

The product should make four things easy:

1. See the baby's current care state immediately.
2. Record common care actions in about 2-3 taps.
3. Share one synchronized source of truth across caregivers.
4. Understand the previous rolling 24 hours and caregiver handoff without reading the entire timeline.

Baby Care must remain usable when Baby Guardian is offline.

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

The separate AI validation track remains:

```text
Xiaomi camera/sensors
  -> i9 OpenVINO / deterministic perception
  -> M2 Baby Agent Orchestrator
  -> JoyAI semantic action
  -> Qwen3-VL ambiguity escalation
  -> semantic candidate
  -> Baby Care / human confirmation
```

M6 must not slow Birth Ready P0 delivery.

## Milestones

### M0 — Repository and delivery foundation — COMPLETE

Gate evidence required and achieved before moving on:

- static lint/typecheck
- unit/contract tests
- real PostgreSQL integration
- production builds
- production Docker Compose smoke
- frozen-lockfile reproducibility
- compact diagnostic artifact path for failures

### M1 — Family and baby foundation — COMPLETE

Deliverables:

- family model
- baby profile (`xiangxiang` as development/display nickname)
- Dad / Mom / Nanny roles
- family-test login/session flow
- authorization boundaries
- actor/source audit metadata

Gate:

- all three roles can access only allowed functionality — verified
- Nanny cannot access restricted admin/private functions — verified
- concurrent writes preserve correct actor/source attribution — verified
- production startup migrates before listen and fails closed — verified
- empty-database production Compose family authorization flow — verified

### M2 — Care recording MVP — DESIGN APPROVED / READY FOR IMPLEMENTATION PLANNING

The real-family care-habits gate is satisfied and the approved design lives on
`codex/m2-care-recording-mvp`. Create and approve its implementation plan before writing
M2 production code. Do not modify the approved care-habit design as part of M1 closure.

Approved implementation scope includes:

- mixed-feeding session
- diaper/stool
- sleep start/end/backfill
- cry/notable event
- spit-up
- weight
- fast undo/edit
- duplicate warning

### M3 — Care workspace

- current-state Home
- unified timeline
- rolling 24-hour summary
- filters
- caregiver handoff
- night/one-handed interaction

### M4 — Reliability

- backup automation
- restore verification
- idempotency/duplicate protection
- migration verification
- retry/weak-network behavior as applicable
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
- latency/confidence/cost evidence

### M7 — Birth Ready freeze

Once M0-M4 are stable and family simulation is usable:

- stop large feature additions
- fix only usability/data/login/sync/backup/critical defects
- run full release gate
- produce `v0.1-rc`, then `v0.1 Birth Ready`

## Autonomous delivery workflow

```text
approved spec
 -> implementation plan
 -> segmented implementation
 -> focused tests
 -> module/integration tests
 -> GitHub CI
 -> compact diagnostic evidence on failure
 -> automatic repair/rerun
 -> review
 -> milestone release gate
 -> user final acceptance only where needed
```

Ordinary software verification belongs on GitHub public runners, not on the user's local terminal.

## Test escalation

```text
affected/focused tests
 -> module/integration
 -> milestone full release gate
```

Do not run every expensive gate for every trivial edit.

## Context/token rule

Agents read the minimum evidence required for the current decision:

1. `agent.md`
2. this current-plan index
3. the relevant feature spec/plan
4. affected contracts/symbols/diff
5. structured failure evidence
6. targeted raw-log ranges only if the structured evidence is insufficient

## Next action

From `codex/m2-care-recording-mvp`, review the approved M2 specification and create the
M2 implementation plan using the verified authoritative M1 production baseline.
