# Baby Care Work Handoff Summary

Updated: 2026-08-21
Repository: `lpearf-pixel/baby-care`

This file is the short handoff for a fresh Work/chat. Read it together with `agent.md`, `docs/PLAN.md`, and `.agent/current-milestone.json` before planning or coding.

## 1. Current authoritative state

- Current active milestone: **M4 — Birth Ready Operations and Data Safety**. Tasks 1–5
  are complete; Task 5 closes at `df43b93`. The next slice is Task 6, fail-closed
  isolated restore, invariants and restored-session sanitation.
- Current completed milestone: **M3 — Care Workspace**, verified complete.
- M3 authoritative final head: `52b042a66122464af338a2b4931315d92dff0965`.
- M3 authoritative CI: `31959895049` — static / unit / PostgreSQL integration / production build / production Compose smoke 5/5 PASS.
- M3 production Compose job: `95196165456` — all four required M3 markers emitted exactly once.
- M1 authoritative baseline: `codex/m1-family-baby-foundation @ 76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`.
- M1 authoritative CI: `31707486985` — 5/5 PASS.
- M2 authoritative implementation branch: `codex/m2-care-recording-implementation`.
- M2 verified implementation head before this handoff-only documentation commit: `222ab8b30dc8e14b3ae95befa413a654760338bd`.
- M2 final authoritative CI on that head: `31768875691` — static / unit / PostgreSQL integration / production build / production Compose smoke all PASS.
- M2 Draft PR: **#4 — `M2: care recording MVP`**, base `codex/m1-family-baby-foundation`.
- `main` has not been modified or merged for M2. Keep PR #4 Draft unless the user explicitly approves merge/integration.
- M3 implementation branch: `codex/m3-care-workspace-implementation`.
- M3 approved design: `docs/superpowers/specs/2026-08-15-m3-care-workspace-design.md`.
- M3 implementation plan: `docs/superpowers/plans/2026-08-16-m3-care-workspace-implementation.md`.
- M3 Draft PR #5 remains open and unmerged.
- M4 branch: `codex/m4-birth-ready-operations`, based on the authoritative M3 final head.
- M4 approved design:
  `docs/superpowers/specs/2026-08-17-m4-birth-ready-operations-data-safety-design.md`.
- M4 implementation plan:
  `docs/superpowers/plans/2026-08-17-m4-birth-ready-operations-data-safety.md`.
- M4 Task 1 implementation: `5d204bd` — strict family export v1 contracts, deterministic
  ordering/filename helpers, Dad/Mom-only export capability, three closed export errors,
  and a startup-validated default 32 MiB bound. Independent review found no issues.
- M4 Task 2 implementation: `6d5a166` — one family-scoped `REPEATABLE READ READ ONLY`
  snapshot, ten fixed set-oriented reads, complete typed export assembly, strict
  revision/relation causality checks, deterministic UTF-8 serialization, and closed
  byte-limit enforcement. Independent review approved with no findings; local API tests
  passed while two enabled PostgreSQL cases await an environment with `TEST_DATABASE_URL`.
- M4 Task 3 implementation: `3ebb95e` through `98de9fc` — authenticated Dad/Mom-only
  family export route, per-actor concurrency gate, private attachment headers and a
  fail-closed allow-listed audit transaction. Independent review approved after bounded
  hardening of authentication, error-shape and rollback evidence. Fresh local API
  regression passed 71 tests with 72 PostgreSQL-dependent tests explicitly skipped
  because `TEST_DATABASE_URL` is not configured.
- M4 Task 4 implementation: `679d9a8` plus privacy-regression closure `40aa49a` — a
  Dad/Mom-only credentialed Web download surface with private warning, generic
  filename, one-flight request and transient Blob URL lifecycle. Nanny receives no
  export DOM. Independent review approved after non-vacuous no-preview, Mom visibility,
  reject-then-retry and anchor-removal coverage. Fresh Web evidence is 87 passed with
  typecheck, production build and repository lint passing. Real-family download remains
  a human gate and was not exercised.
- M4 Task 5 implementation: `fd1d014` through `df43b93` — strict manifest v1,
  streamed private custom-format dump, bounded catalogue checks, PG16/migration gates,
  owner-private storage and kernel-enforced no-replace publication are implemented.
  Preservation-first native failure handling never deletes ambiguous temp state; wrong
  publication is quarantined under a non-final name. Independent review approved after
  five bounded hardening rounds. Fresh Node 24 evidence is 67 operations tests plus root
  typecheck, lint, production build and offline frozen-lock PASS. Real PostgreSQL 16
  dump/list and Linux-native execution remain Task 7/8 and exact-head CI gates.

Release-gate history:

- `codex/m2-task11-release-gate @ 631805f8144d3ece6e2df90468fa4562e0431fc3`
- CI `31768601903` — 5/5 PASS.
- The release branch was used to close migration metadata/docs/release-smoke risk before the authoritative M2 branch was finalized.

## 2. M2 product behavior that is now fixed

M2 is implemented and verified. Do not redesign these facts in later milestones:

- Bottle volume means **actual consumed ml**.
- Bottle capacity is optional metadata only. 90/150/200 ml capacities never become intake shortcuts and never enter milk totals.
- Bottle milk types keep `expressed_breast_milk` and `formula` separate.
- Direct breastfeeding records **total session minutes only**. No left/right timer and no inferred ml.
- Bottle quick values are learned from the latest real records per liquid type; they are not fixed capacity buttons.
- Diaper supports urine / stool / urine+stool and stool detail.
- Sleep supports now / 10 / 20 / 30 minutes ago / custom backfill.
- Frequent facts include burping, spit-up, crying, bathing, temperature, weight, and medication actually administered.
- Medication is factual recording only; no recommendation and no dose calculation.
- Warnings are deterministic and confirmable: possible duplicate, unusual value, old backfill, sleep overlap.
- Rolling 24-hour summary uses active facts and actual occurred time.
- Edit preserves revision history; undo is void-based, never DELETE-based.
- Family/baby/actor/source ownership is derived on the server from the authenticated M1 session.
- Dad/Mom/Nanny attribution is preserved; Nanny has care permissions but not family administration.
- Compact CI diagnostics redact care values and session/setup secrets before evidence is emitted.

## 3. M2 production gate already proven

The production-mode empty-DB Docker Compose flow already verifies the real stack through the Web/API route:

`Dad login -> formula 60 ml with 150 ml bottle capacity -> direct breastfeeding 18 min -> urine+stool diaper -> sleep backfill -> rolling 24h summary -> edit bottle 60->65 -> undo bottle -> Nanny login/write -> timeline proves Nanny attribution`.

Important invariant: bottle capacity 150 ml never contributes to intake total.

## 4. M3 verified scope

M3 is **Care Workspace**, not Guardian integration.

The branch now implements these stable M3 capabilities while preserving the M2 facts above:

- explicit Dad/Mom/Nanny takeover checkpoints with a recent-24-hour fallback for the first handoff;
- derived fixed-window briefings with current state, consumed milk totals, diaper/sleep facts, notable typed events, caregiver activity, and correction activity;
- a typed, filterable, cursor-paginated care timeline with detail, actor/source attribution, and backfill markers;
- complete historical correction with expected-version conflict handling and append-only revision history;
- caregiver-scoped optional on-screen reminders that do not create checkpoint facts;
- per-browser/device auto/day/night display choice and no Web acknowledgement sound.

Exact-head CI run `31959895049` verified all five jobs on
`52b042a66122464af338a2b4931315d92dff0965`. Production Compose job
`95196165456` preserved M1/M2 and emitted `m3-handoff`, `m3-typed-timeline`,
`m3-revision-conflict`, and `m3-care-workspace-release-flow` exactly once. M3 is
verified complete.

## 4.1 M4 approved direction

M4 closes the Birth Ready operational/data-safety loop independently of Guardian:

- Dad/Mom-only versioned private family-data export; Nanny remains denied;
- atomic private PostgreSQL custom-format backup plus strict manifest/digest checks;
- fail-closed restore only into an explicitly empty isolated database;
- synthetic production-mode Dad/Mom/Nanny operational simulation, including backup,
  restore and post-restore verification of timeline, revisions, handoffs and actors.

M4 does not add cloud/off-site backup, automatic deletion, in-place production restore,
full offline synchronization, Guardian/voice integration, medical behavior, or `main`
integration. Tasks 1–5 are implemented and reviewed: contracts and bounds are fixed,
the deterministic repeatable-read export service exists, and Dad/Mom can request the
private audited attachment through the bounded Web download surface. The private atomic
backup library now exists; Task 6 owns fail-closed isolated restore and session sanitation.

## 5. Baby Guardian / baby-monitor-local boundary

`baby-care` and `baby-monitor-local` remain independently deployable.

- Baby Care is the source of truth for family care records.
- Guardian owns sensing, perception, candidate/risk/event lifecycle, evidence, and hardware-specific behavior.
- Guardian must not write directly to the Baby Care database.
- Future integration must use a versioned Guardian Adapter/API/event contract.
- Human records must never be silently overwritten by AI/Guardian conclusions.
- Low-confidence machine conclusions become candidates for human confirmation.
- Raw camera/video/audio should remain local by default; Baby Care should receive semantic events rather than continuous raw media.

Guardian/JoyAI/Qwen integration, automated feeding recognition, medical diagnosis/dose recommendation, and cloud deployment were **not part of verified M3**. Any post-M3 integration requires a separately approved design.

## 6. Xiaomi MJSXJ17CM audio discovery — new handoff note

The user confirmed the Xiaomi `MJSXJ17CM` camera has audio capability.

Current project reality:

- `baby-monitor-local` already consumes the Xiaomi camera video path through go2rtc.
- The earlier Alpha intentionally left audio/two-way talk in Mi Home rather than exposing it through the Baby Monitor dashboard.
- The repository's early stream-probe design already distinguishes audio/no-audio streams.
- We have **not yet proven on the live device** whether the current Xiaomi `cs2+udp` / selected subtype source is exposing a usable audio track to the local go2rtc/RTSP consumer.

Next hardware investigation, when Guardian integration work is explicitly started:

1. Probe the live local `source` stream and inspect audio tracks/codecs/sample rate/channels.
2. If the track is already present, split the same local camera producer into video and audio consumers instead of adding a separate microphone.
3. Keep go2rtc/audio consumption loopback/local-only by default.
4. Preferred privacy architecture is short in-memory audio buffering -> VAD -> local ASR -> semantic fusion -> discard raw audio, rather than continuous audio recording.
5. Camera audio can become the preferred environmental speech input for future multimodal Guardian inference; phone/browser microphone remains a possible fallback, not the first assumption.

This is a **future Guardian/multimodal integration candidate**, not permission to expand M3 Care Workspace automatically.

## 7. Approved direction — voice-first care interaction

The user has expanded the earlier feeding-only request into a long-term **voice-first Baby Care interaction** direction. Routine create/query/correct/undo operations should normally be possible through the local assistant **小小**, while the PWA remains the fallback, confirmation, history, and correction surface.

Representative interaction:

```text
Caregiver: 嘿，小小，我要喂奶了
Assistant: 好的
```

Target coverage includes feeding, diaper/stool, sleep/wake, burping, spit-up, crying, bathing, temperature, weight, and medication actually administered, plus queries such as the last feeding time and rolling 24-hour totals.

System direction:

1. `baby-monitor-local` builds a local Voice Care Gateway: Xiaomi audio -> VAD/wake -> local ASR -> deterministic care intent/dialogue -> acknowledgement -> semantic candidate/outbox.
2. A wake opens a short configurable conversation window so follow-up values/corrections do not require repeating the wake phrase.
3. A voice event may start a care-session state machine. Camera analysis can help estimate process boundaries, but must not infer bottle intake from images or silently confirm a record.
4. Guardian emits versioned semantic candidates through an API/event contract and never writes the Baby Care database directly.
5. Baby Care owns authenticated actor attribution, confirmation, revision/undo, the final care record, Dashboard display, and analytics.
6. A default bottle amount is a suggested value with explicit provenance, not confirmed actual consumed ml.
7. Raw continuous household audio/video remains local; short in-memory audio windows are discarded after intent extraction.

Safety policy:

- Low-risk reversible actions use brief acknowledgement and immediate undo.
- Quantities/times are repeated when confidence is low or validation warns.
- Medication requires explicit confirmation of name, dose, unit, and administered time. The system records facts only and never recommends or calculates a dose.
- The camera microphone must not guess Dad/Mom/Nanny from voice. Use a revocable Baby Care active-caregiver session/lease; otherwise keep the event system-sourced and pending confirmation.
- Offline Guardian uses an idempotent local outbox and synchronizes later without duplicating records.

Night policy:

- Quiet hours and volume cap are configurable household settings.
- Successful low-risk commands receive only a short, low-volume response.
- Do not automatically increase volume in response to crying/noise; use a soft chime, PWA visual/haptic result, or pending state when speech would be disruptive.
- TTS must be prevented from re-triggering wake/ASR through capture ducking/echo control.
- Phase 1 should use a proven configurable macOS/i9 or external-speaker sink. Xiaomi camera-speaker/two-way talk remains optional until local control is proven.

Required phased delivery in `baby-monitor-local`:

- G0: live Xiaomi audio-track/codec/latency probe with privacy-safe diagnostics and rollback;
- G1: local wake/ASR/TTS loop, quiet-hours policy, output-sink abstraction, replay fixtures;
- G2: deterministic care-command grammar, dialogue/session state machine, safety tiers, corrections/undo, actor-lease boundary, idempotent outbox;
- G3: feeding/care camera fusion and a versioned Baby Care contract simulator using synthetic/replay inputs;
- G4: separate Baby Care Adapter/confirmation integration after its contract is approved.

This remains separate from verified M3 Care Workspace. The first code work belongs on a new `baby-monitor-local` feature branch based on its verified Guardian branch; Baby Care integration follows separately.

## 8. Autonomous development rules to preserve

- Read `agent.md` first, then this file, `docs/PLAN.md`, `.agent/current-milestone.json`, and only the relevant approved spec/plan.
- Use RED -> GREEN -> focused tests -> integration -> exact-head CI.
- Use GitHub public runners for ordinary verification.
- Diagnose CI from compact structured evidence before loading raw logs.
- Continue reversible work autonomously after spec approval.
- Do not ask the user to run ordinary local commands when CI/connector/repository automation can do the job.
- Do not modify/merge `main` without explicit user approval.
- Preserve user work; do not reset/overwrite unrelated changes.
- Only stop for major product direction, credentials/payment, destructive/irreversible actions, or real hardware/family acceptance that automation cannot reproduce.

## 9. Fresh Work entry point

The next Work should continue the approved M4 design workflow without redesigning
M2/M3 or implicitly beginning Guardian coding.

Recommended first sequence:

1. Read the authoritative state files and the M4 design.
2. Preserve the authoritative M3 pair `52b042a66122464af338a2b4931315d92dff0965` / `31959895049`.
3. Resume at Task 6 of the approved M4 implementation plan.
4. Keep Guardian/audio/AI outside M4 and preserve the independent-system boundary.

## 10. Copy/paste prompt for M4 implementation approval

```text
读取 `agent.md`、`summary.md`、`docs/PLAN.md`、
`.agent/current-milestone.json`、已批准的 M4 规格和详细计划：
`docs/superpowers/specs/2026-08-17-m4-birth-ready-operations-data-safety-design.md`
`docs/superpowers/plans/2026-08-17-m4-birth-ready-operations-data-safety.md`。

基线为 `codex/m4-birth-ready-operations`，来源是已通过 CI `31959895049`
五项门禁的 M3 精确头 `52b042a66122464af338a2b4931315d92dff0965`。

按已批准规格和正式计划执行 Task 3。严格 RED-GREEN，完成聚焦测试、回归、
审查和本地提交后更新状态。普通实现问题和可恢复测试失败自行处理。

不要开发 Guardian/语音、完整离线同步、云备份、医疗功能或 in-place restore；
不要修改/合并 main，不 push，直到另行批准。baby-monitor-local 当前训练不阻塞本项目。
```
