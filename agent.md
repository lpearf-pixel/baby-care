# baby-care Agent Context

> Canonical long-lived context for all agents working on `lpearf-pixel/baby-care`.
> Read this file before planning, coding, debugging, reviewing, or releasing.
> Keep this file concise. Put feature-specific detail in `docs/` and link to it instead of duplicating it here.

## 1. Product mission

`baby-care` is the family care workspace for a newborn expected around 2026-09-10.

Product positioning:

- Family product: practical newborn feeding/care tracking and handoff.
- Content positioning: **程序员爸爸的科学育儿实验室**.
- The software must be useful first; content production is downstream of real family use.
- Do not turn observations into medical diagnoses. Record, summarize, detect trends, and surface uncertainty; medical decisions remain with qualified clinicians and caregivers.

## 2. Initial users and access

Birth Ready v0.1 targets one family and one baby with three roles:

- Dad
- Mom
- Nanny / 月嫂

Current baby development/display nickname: **xiangxiang**.

Requirements:

- Dad and Mom can manage family settings, export data, and review Guardian information.
- Nanny can record routine care and view necessary handoff information, but should not receive unnecessary private/medical/admin access.
- All three users share one source of truth.
- Every record preserves actor, timestamp, source, and edit history where relevant.

## 3. Client and deployment strategy

Birth Ready is **Web/PWA first**.

- Support iPhone, Android, and Mac browsers.
- Do not build native iOS/Android or WeChat Mini Program for P0.
- Develop and test locally with Docker Compose first.
- No production server exists yet; cloud deployment is a later milestone after local family simulation is stable.
- Production design must remain portable to a small cloud host without rewriting the application.

Preferred logical layout:

```text
apps/web
apps/api
packages/domain
packages/shared
packages/guardian-adapter
infra/docker
infra/backup
docs
```

## 4. Product operating principle

The product is a **care workspace**, not a form collection system.

Four P0 usability rules:

1. Opening the home screen should immediately answer the baby's current state and the most recent important care events.
2. A common care action should normally be recordable in about 2-3 taps.
3. A person taking over care should understand the prior shift without manually reading the full timeline.
4. The family should be able to accurately review the previous rolling 24 hours.

Design for one-handed, sleep-deprived, night-time use.

## 5. P0 care domains

Birth Ready prioritizes:

- Mixed feeding
- Diaper / stool
- Sleep
- Cry / notable care event
- Spit-up
- Weight
- Unified timeline
- Current state
- Rolling 24-hour summary
- Family handoff / 交接班
- Fast undo/edit and duplicate prevention
- Backup and restore

Defer non-critical features such as advanced AI analytics, vaccination management, native apps, complex content generation, or broad health knowledge chat until core family use is stable.

### M2 real-care-habits gate

Before implementing or finalizing M2 Care Recording MVP interaction defaults, **ask the user for the family's real care habits**. Do not silently lock UX around placeholder assumptions.

At minimum collect:

- common bottle volumes / preferred quick-entry buttons
- mixed-feeding workflow and whether bottle milk should distinguish expressed breast milk vs formula
- breastfeeding tracking preference: left/right timing vs simpler total-session timing
- diaper/stool detail level the family actually wants to record
- nanny handoff/shift timing and what free-text notes matter
- any other repeated care action that should be reachable in about 2-3 taps

The user explicitly asked to be reminded at the care-recording stage. Treat this as a required product-input gate, not optional polish.

### Mixed feeding rule

A feeding is a **session**, not just an isolated row. One session may contain:

- left/right breastfeeding segments
- bottle breast milk
- formula
- burping
- spit-up

The UI must support quick entry and later correction/completion.

### Time rule

Use rolling 24-hour summaries as a primary operational view. Calendar-day summaries may exist, but midnight reset must not be the only view.

## 6. Baby Guardian boundary

`baby-care` and `baby-monitor-local` remain independently deployable.

- Baby Care must continue to work when Guardian is offline.
- Guardian must not write directly to Baby Care's database.
- Integration occurs through versioned APIs/events via `packages/guardian-adapter` or equivalent.
- Guardian events remain distinguishable from human records.
- AI must not silently overwrite human-entered care records.
- Low-confidence Guardian conclusions become candidates for human confirmation.

Examples of useful semantic events:

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

## 7. Baby Agent Orchestrator

A dedicated Agent Orchestrator is part of the target architecture. The M2 Mac is the preferred AI orchestration node; the i9/Guardian machine remains the fast perception node.

Logical runtime flow:

```text
Camera / sensors
  -> L0 fast perception / deterministic rules
  -> Agent Orchestrator
  -> action/session inference
  -> semantic event
  -> Baby Care candidate / timeline
```

The orchestrator maintains a **Baby World State / Care Session**, not just isolated frame classifications.

Example care session:

```text
wake -> picked up -> feeding -> burping -> diaper change -> soothing -> returned to bed -> sleep
```

## 8. Runtime model hierarchy

Use the cheapest reliable layer first.

- L0: deterministic rules, CV/OpenVINO, state machines. High-frequency perception.
- L1: JoyAI or another lightweight/streaming semantic model for continuous action understanding.
- L2: Qwen3-VL or equivalent for ambiguous/complex visual review.
- Human confirmation: when model evidence remains uncertain or consequential.

Do **not** send every video frame to a large VLM.

Escalate only when a cheaper layer cannot make a sufficiently confident decision.

Models must be registered through a model registry with at least:

- name/version
- device
- capability
- modality
- expected latency/resource cost
- confidence threshold
- fallback
- health state

JoyAI-on-Mac is a validation track, not yet a production assumption. Prefer an MLX/Apple-Silicon PoC before depending on it for Birth Ready.

## 9. Cost-aware development agent hierarchy

Development follows the same principle as runtime inference.

```text
L0 deterministic tools
  -> L1 small model
  -> L2 coding model
  -> L3 high-reasoning model
```

Use L3 primarily for:

- architecture
- specifications/contracts
- cross-module root-cause analysis
- high-risk code review
- release review

Do not spend high-reasoning-model context on routine lint fixes, simple type errors, fixture edits, trivial configuration, or mechanical changes when a lower layer can handle them.

## 10. Token and context efficiency

Core rule:

> Models read the minimum evidence required for the current decision, not everything that might be useful.

Mandatory practices:

- Diff-first, not file-first.
- Symbol/contract-first, not repository-wide rereads.
- Progressive disclosure: load more context only when evidence is insufficient.
- Keep a repo map and dependency map as the codebase grows.
- Summarize sub-agent attempts before escalation; do not forward full conversations.
- Prefer structured test evidence over prose transcript.
- Maintain token/context budgets per task where orchestration supports them.

As the repository grows, maintain compact indexes under `.agent/`, for example:

```text
.agent/architecture.md
.agent/repo-map.json
.agent/contracts.json
.agent/dependency-map.json
.agent/decisions.md
.agent/current-milestone.json
.agent/known-risks.json
```

Do not create these merely as empty ceremony; create/update them when they begin reducing repeated context reads.

## 11. Structured diagnostics and logging

Never use "read the entire log" as the default debugging workflow.

Application and CI diagnostics should expose structured, searchable evidence with fields such as:

```text
timestamp
trace_id
span_id
component
event_code
severity
expected
actual
state_before
state_after
error_class
suspect_component
evidence_pointer
```

CI failures should produce a compact diagnostic pack where useful:

```text
diagnostics/latest/
  summary.json
  failing-tests.json
  changed-files.txt
  relevant-diff.patch
  trace.jsonl
  environment.json
  artifact-index.json
```

Keep full raw logs as artifacts, but do not load them into model context unless structured evidence is insufficient. Fetch only targeted ranges or trace IDs when escalation is needed.

## 12. Testing strategy

Small changes should not automatically trigger every expensive test locally.

Default progression:

```text
focused affected tests
  -> module/integration tests
  -> milestone/release gate full suite
```

Automate on GitHub public runners whenever possible:

- lint
- type check
- unit tests
- API/database integration
- migrations
- web build
- browser E2E
- mobile viewports
- Docker build/Compose integration
- backup/restore
- security/static checks where appropriate

Hardware-specific tests are a separate gate for:

- Xiaomi camera
- i9 Guardian runtime
- M2 AI runtime
- local network/device integration

Prefer replayable, privacy-safe video fixtures and synthetic/doll scenarios over repeatedly requiring live family testing.

## 13. Autonomous delivery workflow

The default collaboration model is not "agent edits -> user runs local command -> user pastes logs".

After an approved specification, agents should continue through normal reversible work without repeatedly interrupting the user:

```text
spec
-> implementation plan
-> implementation
-> focused tests
-> integration tests
-> CI
-> diagnose failures
-> repair
-> rerun
-> review
-> release gate
-> usable release candidate
-> user final acceptance
```

User involvement should normally be limited to:

1. major product-direction changes
2. initial specification approval
3. credentials/payment/destructive or otherwise irreversible actions
4. final real-family/hardware acceptance when automation cannot reproduce it

Use GitHub public runners by default for general CI. Do not depend on a user's local terminal for ordinary software verification.

## 14. Definition of Done

`DONE` does not mean "code written".

For a feature, Done means the applicable combination of:

- implementation complete
- focused tests pass
- integration/E2E pass
- CI evidence available
- migrations/rollback considered
- operational diagnostics added where needed
- documentation/contracts updated
- release gate passes at the milestone boundary

Only then call the feature complete.

## 15. Privacy and content boundary

The baby may appear on camera/content, but identity and household privacy remain protected.

Do not expose by default:

- full legal name
- precise identifying birth/medical records
- home address/location
- hospital/room real-time location
- IDs/document numbers
- camera/public endpoint credentials
- family network details
- EXIF/location metadata

Raw Guardian video should remain local by default. Baby Care should prefer structured semantic events over uploading continuous raw video.

Content production must use a deliberate export/sanitization boundary. Never directly publish from the private baby database.

## 16. Global-memory maintenance rule

Update this file when a decision is:

- cross-cutting
- long-lived
- likely to affect multiple future tasks
- important enough that forgetting it could cause architectural or safety regressions

Do not put temporary bugs, long logs, individual experiment outputs, or one-off implementation details here.

Before any new implementation task:

1. Read `agent.md`.
2. Read the current milestone/plan.
3. Read only the relevant feature specification and affected contracts.
4. Inspect the smallest necessary code surface.
5. Implement and verify according to the autonomous delivery rules above.

## 17. Current canonical plan

See `docs/PLAN.md` for the active Birth Ready milestones and execution order.
