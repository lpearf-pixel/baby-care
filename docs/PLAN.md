# Baby Care Birth Ready Plan

Status: active
Target: `v0.1 Birth Ready`
Expected birth date: 2026-09-10
Repository: `lpearf-pixel/baby-care`

This plan is intentionally execution-focused. Long-lived project rules live in `/agent.md` and should be read first.

## 1. Product goal

Deliver a practical Web/PWA newborn care workspace that Dad, Mom, and Nanny can use on iPhone, Android, and Mac before the expected birth date.

Birth Ready succeeds when the family can:

- see the baby's current care state immediately
- record common actions in about 2-3 taps
- share one synchronized source of truth
- understand the previous shift without reading the whole timeline
- review an accurate rolling 24-hour summary
- correct mistakes quickly
- recover data from backup
- continue using Baby Care even when Baby Guardian is offline

## 2. Scope boundary

### P0: required for Birth Ready

- Web/PWA responsive shell
- family/user roles: Dad, Mom, Nanny
- one baby profile
- authentication suitable for family testing
- current-state home screen
- mixed-feeding sessions
- diaper/stool records
- sleep start/end and backfill correction
- cry/notable care event
- spit-up
- weight
- unified timeline
- rolling 24-hour summary
- handoff/shift summary
- fast undo/edit
- duplicate-event warning
- audit/source metadata
- backup/restore
- structured diagnostics
- Docker Compose local deployment
- CI on GitHub public runners

### P1: after core P0 is stable

- 7-day trends
- richer feeding/sleep analysis
- Guardian Adapter semantic-event ingestion
- Guardian candidate confirmation UI
- care-session grouping
- data export
- production cloud deployment

### P2: validation tracks, must not block Birth Ready

- M2 Baby Agent Orchestrator runtime
- JoyAI-on-Mac/MLX feasibility PoC
- feeding-action recognition
- burping/diaper/soothing action recognition
- Qwen3-VL semantic escalation
- content opportunity generation

### Explicitly deferred

- native iOS/Android apps
- WeChat Mini Program
- broad medical knowledge chat
- diagnosis/prescription behavior
- complex vaccination management
- full photo/video library
- continuous cloud upload of Guardian video

## 3. Architecture baseline

```text
iPhone / Android / Mac
        |
        v
   Baby Care Web/PWA
        |
        v
     Baby Care API
        |
   +----+-------------------+
   |                        |
PostgreSQL              backup/export
   |
   v
Unified Baby Timeline
   ^
   |
Guardian Adapter  <---- versioned API/events ---- baby-monitor-local
```

Guardian remains independently deployable. It never writes directly to the Baby Care database.

Target AI architecture, developed separately from P0 care recording:

```text
Xiaomi camera / sensors
       |
       v
i9 fast perception
OpenVINO / deterministic CV
       |
       v
M2 Baby Agent Orchestrator
       |
 +-----+------------------+
 |                        |
JoyAI / streaming       Qwen3-VL review
semantic action         ambiguity escalation
 |                        |
 +-----------+------------+
             |
             v
      semantic care event
             |
             v
         Baby Care
```

## 4. Core UX flows

### 4.1 Home / current state

Opening the app should answer with zero additional navigation:

- current baby state, e.g. sleeping and duration
- time since last feeding
- time since last diaper
- most recent care events
- rolling 24-hour key totals

### 4.2 Fast record

High-frequency actions should be directly available from Home.

Examples:

```text
Bottle 60 / 70 / 80 / 90 ml
Start breastfeeding
Wet diaper
Stool
Start sleep / Wake
```

Detailed forms are secondary. Users should be able to save quickly and add details later.

### 4.3 Feeding session

A feeding session may combine:

```text
left breast -> right breast -> bottle supplement -> burp -> spit-up
```

The system stores one care session with child segments rather than forcing users to reason about unrelated rows.

### 4.4 Sleep correction

Support common backfill choices:

- now
- 10 minutes ago
- 20 minutes ago
- 30 minutes ago
- custom time

Guardian may later suggest a correction, but never silently rewrites human records.

### 4.5 Handoff

A shift summary should present:

- feeding count/amount/important details
- diaper/stool
- sleep totals and longest sleep
- cry/notable events
- spit-up/other special events
- free-text caregiver note

## 5. Data principles

Every care record should preserve at least:

```text
id
baby_id
family_id
occurred_at
recorded_at
actor_id
source: manual | guardian | device | import | ai
status
created_at
updated_at
```

Use explicit domain models for feeding sessions and their segments.

Keep AI/Guardian candidates separate from confirmed human care facts.

## 6. Milestones

### M0 — Repository and delivery foundation

Goal: autonomous-development-ready skeleton.

Deliverables:

- `/agent.md`
- this plan
- project package/workspace structure
- Web/PWA shell
- API skeleton
- PostgreSQL
- Docker Compose
- `.env.example`
- configuration validation
- structured logging base contract
- GitHub Actions baseline
- test harness

Gate:

- clean checkout can build and test on GitHub public runner
- Docker Compose model validates
- app/API/database health checks are machine-readable

### M1 — Family and baby foundation

Deliverables:

- family
- baby profile
- Dad/Mom/Nanny roles
- basic login/session flow
- authorization boundaries
- audit/source metadata

Gate:

- three roles can access allowed functionality
- Nanny cannot access restricted admin/private functions
- concurrent records preserve the correct actor

### M2 — Care recording MVP

Deliverables:

- feeding session
- diaper/stool
- sleep
- cry/notable event
- spit-up
- weight
- fast undo/edit
- duplicate warning

Gate:

- common actions are usable in roughly 2-3 taps
- erroneous values can be corrected quickly
- mixed feeding is represented as one coherent session
- targeted unit/integration/browser tests pass

### M3 — Care workspace

Deliverables:

- current-state Home
- unified timeline
- rolling 24-hour summary
- filters
- caregiver handoff
- night-friendly interaction

Gate:

- user can answer "what is happening now?" from Home
- user can answer "what happened while I was asleep?" from Handoff
- rolling 24-hour totals remain correct across midnight

### M4 — Reliability

Deliverables:

- backup automation
- restore test
- error/trace contracts
- diagnostic pack generation
- weak/retry network behavior where applicable
- duplicate/idempotency protection
- database migration verification

Gate:

- backup/restore is tested, not assumed
- CI failures expose compact structured diagnostics
- ordinary debugging does not require reading entire raw logs

### M5 — Guardian integration contract

Deliverables:

- versioned Guardian event contract
- `guardian-adapter`
- candidate ingestion
- confirmation/ignore flow
- source/confidence display
- idempotency/deduplication

Initial candidate vocabulary:

```text
baby_picked_up
feeding_candidate
bottle_feeding_candidate
burping_candidate
diaper_change_candidate
soothing_candidate
baby_returned_to_bed
sleep_started
sleep_ended
```

Gate:

- Baby Care continues to operate when Guardian is unavailable
- simulated Guardian events can be replayed in CI
- AI events never silently overwrite human facts

### M6 — M2 Agent Orchestrator PoC

This is an independent validation track and does not block M0-M4.

Deliverables:

- model registry contract
- task/routing contract
- Baby World State
- Care Session state machine
- L0/L1/L2 escalation logic
- JoyAI Mac feasibility benchmark
- Qwen3-VL fallback path
- replayable action fixtures

Target routing:

```text
L0 rules/OpenVINO
  -> confident: finish
  -> candidate: JoyAI
  -> low confidence/conflict: Qwen3-VL
  -> still uncertain: human confirmation
```

Gate:

- a model can be swapped without rewriting Guardian/Baby Care domain logic
- orchestrator decisions are traceable
- every escalation records cost/latency/confidence evidence

### M7 — Birth Ready freeze

Start once M0-M4 are stable and family simulation is usable.

During freeze:

- no large new features
- fix only bugs, data safety, usability blockers, login/sync, backup, and critical UI defects
- run full release gate
- produce `v0.1-rc` and then `v0.1 Birth Ready`

## 7. Autonomous development workflow

After a feature/spec is approved, ordinary reversible development should continue without repeatedly asking the user to run local commands.

```text
approved spec
 -> implementation plan
 -> code
 -> focused tests
 -> module/integration tests
 -> GitHub CI
 -> inspect structured failure evidence
 -> repair
 -> rerun
 -> review
 -> milestone release gate
```

Use GitHub public runners for software tests by default.

Only require user-side hardware acceptance when a test genuinely depends on:

- Xiaomi camera
- i9 Guardian host
- M2 local model runtime
- actual family LAN/hardware behavior

## 8. Test and CI strategy

### Focused tests

Run the smallest relevant tests first based on changed symbols/contracts.

### Module gate

After focused tests pass, run affected module/integration tests.

### Release gate

At milestone boundaries run the full applicable suite:

- lint
- type check
- unit
- API integration
- PostgreSQL/migration
- web build
- browser E2E
- iPhone/Android viewport checks
- Docker build/Compose
- backup/restore
- security/static checks as configured

Do not use a full release gate for every trivial edit.

## 9. Token-efficient diagnostics plan

Design CI and runtime observability for agent consumption.

Preferred failure event shape:

```json
{
  "event": "FEEDING_SESSION_TEST_FAILED",
  "trace_id": "run-...",
  "component": "feeding-session",
  "expected": "session.status=completed",
  "actual": "session.status=active",
  "error_code": "SESSION_NOT_CLOSED",
  "suspect": "...",
  "evidence": ["artifact://..."]
}
```

Full logs remain available as artifacts, but agents should first read:

1. failing step summary
2. structured diagnostic summary
3. changed files/diff
4. relevant trace IDs
5. targeted source symbols

Only then request targeted raw-log ranges if still necessary.

## 10. Development model routing

Default work routing:

- L0 tools/rules: grep, compiler, tests, formatters, schema validation, AST/query tools
- L1 small model: classification, simple fixes, fixtures, repetitive mechanical tasks
- L2 coding model: normal feature implementation and local refactors
- L3 high-reasoning model: architecture, contracts, cross-module root causes, high-risk review, release review

Escalation should carry a compact summary, not the full lower-agent transcript.

## 11. Current execution order

The current recommended sequence is:

```text
M0 Repository/delivery foundation
 -> M1 Family/baby foundation
 -> M2 Care recording MVP
 -> M3 Care workspace
 -> M4 Reliability
 -> M5 Guardian integration
```

Run M6 Agent Orchestrator PoC in parallel only when it does not slow Birth Ready P0 delivery.

## 12. Current status

As of 2026-08-13:

- repository created
- architecture direction approved
- Web/PWA direction approved
- no production server yet
- no WeChat Mini Program in P0
- Baby Care and Baby Guardian separation approved
- M2 Agent Orchestrator direction approved
- cost-aware model routing approved
- token-efficient structured diagnostics approved
- autonomous delivery workflow approved
- implementation has not started yet

Next action: execute M0 after the written plan/spec gate is accepted.
