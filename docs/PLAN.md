# Baby Care Birth Ready Plan

Status: active  
Target: `v0.1 Birth Ready`  
Expected birth date: 2026-09-10  
Repository: `lpearf-pixel/baby-care`

Read `/agent.md` first. This file is the compact execution index; detailed milestone designs/plans live under `docs/superpowers/`.

## Current state

Current design milestone: **M2 — Care Recording MVP**  
M2 design status: **approved and written; pending written-spec review before implementation plan**  
Implementation blocker: **M1-H production startup/Compose closure must be completed and integrated first**

Verified repository facts on 2026-08-13:

- M0 delivery foundation: complete.
- M1 core family/baby/session/authorization/audit/Web work: implemented on `codex/m1-family-baby-foundation` at `f0f3bbc2035ea6c6af6c89e47b17bd1b0ca5419c`.
- M1-H branch `codex/m1-h-production-flow` is three commits ahead of the M1 branch and contains unfinished RED production startup/Compose work; it must not be described as a completed GREEN release gate until reconciled and reverified.
- M2 real-family care-habits input gate: satisfied.
- M2 design: `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`.

## Confirmed M2 family inputs

- Baby nickname: `xiangxiang`.
- Bottle capacities: 90 / 150 / 200 ml; capacities are **not** intake shortcuts.
- Bottle feeds distinguish expressed breast milk vs formula.
- Direct breastfeeding records total session duration only.
- Bottle quick values come from recent actual consumed ml, separately per milk type.
- Diaper/stool uses detailed mode when stool is present.
- Sleep requires now / 10 / 20 / 30 minutes ago / custom backfill.
- Frequent care events: burping, spit-up, crying, bathing, temperature, weight, medication administration.
- Home priority: last feed + amount/duration, last diaper elapsed time, rolling 24-hour measurable bottle intake.
- Nanny handoff schedule remains unknown and must not be hard-coded.

## Milestone sequence

### M0 — Repository and delivery foundation — COMPLETE

Delivered monorepo, Web/PWA shell, API/PostgreSQL foundation, Docker Compose, segmented public-runner CI, and compact diagnostics.

### M1 — Family and baby foundation — CORE IMPLEMENTED / PRODUCTION GATE CORRECTION REQUIRED

Implemented core scope:

- Family + `xiangxiang`
- Dad/Mom/Nanny identities and permissions
- Setup/login/server-side session flow
- server-side authorization
- actor/source audit trail
- family identity Web/PWA states

Remaining prerequisite before M2 implementation:

- close M1-H migrate-before-listen production startup and full Compose family authorization flow
- verify exact-head static/unit/integration/build/compose gates
- advance the authoritative M1 baseline and correct PR/status evidence

### M2 — Care recording MVP — DESIGN APPROVED

Approved design includes:

- mixed Feeding Session
- actual bottle intake ml; bottle capacity kept separate
- dynamic recent bottle-amount shortcuts
- direct breastfeeding total-duration recording
- diaper/stool detailed mode
- sleep interval/backfill/correction
- burping, spit-up, crying, bathing, temperature, weight, medication administration
- rolling 24-hour bottle ml and breastfeeding count/minutes
- fast edit/undo
- conservative duplicate warning
- soft sanity warning without silent correction

Implementation may start only after the written spec review gate and M1-H prerequisite are satisfied.

### M3 — Care workspace

- richer current-state Home
- unified timeline presentation and filters
- caregiver handoff/shift UX after the real Nanny schedule is known
- night/one-handed refinement

### M4 — Reliability

- backup automation and restore verification
- migration/retry/idempotency hardening
- release-level diagnostics

### M5 — Guardian integration

- versioned Guardian event contract
- adapter and candidate ingestion
- confirm/ignore flow
- AI never silently overwrites human care facts

### M6 — Baby Agent Orchestrator PoC — PARALLEL / NON-BLOCKING

- model registry
- Baby World State / Care Session state machine
- OpenVINO -> JoyAI -> Qwen escalation
- replayable fixtures and latency/confidence evidence

### M7 — Birth Ready freeze

Freeze large feature additions, fix usability/data/login/sync/backup/critical defects, and produce release candidates.

## Autonomous delivery workflow

```text
approved design
 -> written spec review
 -> implementation plan
 -> close prerequisite gates
 -> segmented RED/GREEN implementation
 -> focused tests
 -> PostgreSQL/Web/module integration
 -> GitHub CI
 -> compact diagnostics on failure
 -> automatic repair/rerun
 -> milestone review and release gate
```

Ordinary software verification belongs on GitHub public runners, not the user's local terminal.

## Context/token rule

Agents read the minimum evidence required:

1. `agent.md`
2. this execution index
3. the relevant feature spec/plan
4. affected contracts/symbols/diff
5. compact structured failure evidence
6. targeted raw-log ranges only when compact evidence is insufficient

## Next action

User reviews the written M2 spec. After approval of the written spec, create the M2 implementation plan; its first executable prerequisite is to repair and reverify M1-H before writing M2 care-domain production code.
