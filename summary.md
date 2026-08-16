# Baby Care Work Handoff Summary

Updated: 2026-08-16
Repository: `lpearf-pixel/baby-care`

This file is the short handoff for a fresh Work/chat. Read it together with `agent.md`, `docs/PLAN.md`, and `.agent/current-milestone.json` before planning or coding.

## 1. Current authoritative state

- Current completed milestone: **M2 — Care Recording MVP**.
- Current milestone: **M3 — Care Workspace**, implementation release candidate awaiting production Compose and exact-head five-job CI.
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
- M3 verified head and CI run remain unset until one exact final head passes static, unit/contracts, PostgreSQL integration, production build, and production Compose smoke.

Release-gate history:

- `codex/m2-task11-release-gate @ 631805f8144d3ece6e2df90468fa4562e0431fc3`
- CI `31768601903` — 5/5 PASS.
- The release branch was used to close migration metadata/docs/release-smoke risk before the authoritative M2 branch was finalized.

## 2. M2 product behavior that is now fixed

M2 is implemented and verified. Do not redesign these facts while starting M3:

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

## 4. M3 implemented release-candidate scope

M3 is **Care Workspace**, not Guardian integration.

The branch now implements these stable M3 capabilities while preserving the M2 facts above:

- explicit Dad/Mom/Nanny takeover checkpoints with a recent-24-hour fallback for the first handoff;
- derived fixed-window briefings with current state, consumed milk totals, diaper/sleep facts, notable typed events, caregiver activity, and correction activity;
- a typed, filterable, cursor-paginated care timeline with detail, actor/source attribution, and backfill markers;
- complete historical correction with expected-version conflict handling and append-only revision history;
- caregiver-scoped optional on-screen reminders that do not create checkpoint facts;
- per-browser/device auto/day/night display choice and no Web acknowledgement sound.

The production smoke preserves M1/M2 and encodes the complete M3 flow, but Task 9 could not execute Docker locally because the Docker CLI is unavailable. Do not mark M3 complete until the controller records the four M3 smoke markers and all five CI jobs passing on one exact final head.

## 5. Baby Guardian / baby-monitor-local boundary

`baby-care` and `baby-monitor-local` remain independently deployable.

- Baby Care is the source of truth for family care records.
- Guardian owns sensing, perception, candidate/risk/event lifecycle, evidence, and hardware-specific behavior.
- Guardian must not write directly to the Baby Care database.
- Future integration must use a versioned Guardian Adapter/API/event contract.
- Human records must never be silently overwritten by AI/Guardian conclusions.
- Low-confidence machine conclusions become candidates for human confirmation.
- Raw camera/video/audio should remain local by default; Baby Care should receive semantic events rather than continuous raw media.

Guardian/JoyAI/Qwen integration, automated feeding recognition, medical diagnosis/dose recommendation, and cloud deployment are **not part of the current M3 scope unless a separate design explicitly changes the milestone boundary**.

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

This remains separate from the current M3 Care Workspace implementation. The first code work belongs on a new `baby-monitor-local` feature branch based on its verified Guardian branch; Baby Care integration follows separately.

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

The next Work should close the **M3 release gate**, not redesign or reimplement M2/M3 and not begin Guardian coding.

Recommended first sequence:

1. Read the authoritative state files.
2. Push the controller-approved Task 9 candidate without modifying `main`.
3. Require static, unit/contracts, PostgreSQL integration, production build, and production Compose smoke on the same exact head.
4. Confirm the four exact M3 smoke markers from the production Compose job.
5. Record `m3_verified_head`, `m3_verified_ci_run`, and `m3_verification_result` only from that authoritative run.
6. Keep Guardian/audio/AI outside M3 unless the user separately approves a scope change.

## 10. Copy/paste prompt for the controller release gate

```text
你现在接管长期项目 `lpearf-pixel/baby-care`。

先读取并核验真实仓库状态：

- `agent.md`
- `summary.md`
- `docs/PLAN.md`
- `.agent/current-milestone.json`
- `docs/superpowers/specs/2026-08-15-m3-care-workspace-design.md`
- `docs/superpowers/plans/2026-08-16-m3-care-workspace-implementation.md`
- `.superpowers/sdd/2026-08-16-m3-care-workspace-implementation/task-9-report.md`

当前 M3 候选分支是 `codex/m3-care-workspace-implementation`。Task 9 已准备完整 production smoke，但执行环境没有 Docker CLI，因此不得在得到 CI 证据前声称 M3 完成。不要重新实现 M2/M3，不要修改或合并 `main`。

你的当前任务是 push controller 批准的最终候选，并要求同一 exact head 的 static、unit/contracts、PostgreSQL integration、production build、production Compose smoke 5/5 PASS。Compose 日志必须出现四个精确 marker：`m3-handoff`、`m3-typed-timeline`、`m3-revision-conflict`、`m3-care-workspace-release-flow`。

必须保留 M2 已确定的语义：奶瓶容量不等于摄入量；瓶喂实际 ml；母乳瓶喂与配方奶分开；亲喂只记录总时长、不做左右乳计时、不推算 ml；rolling 24h；warning 显式确认；edit 保留 revision；undo=void；actor/family/baby/source 由服务端认证上下文派生；药物只记录事实，不推荐/计算剂量。

`baby-monitor-local`/Guardian 是独立系统。小米 MJSXJ17CM 音频已经被识别为未来 Guardian 多模态输入候选，但当前 live audio track 尚需真机 probe。不要把 Guardian/JoyAI/Qwen/自动喂奶识别直接塞进 M3；除非我明确批准新的集成设计。

工作方式：普通可逆工作自动继续；使用 GitHub 公共 runner；失败自行诊断修复重跑；不要让我执行普通本地命令；只在重大产品方向、凭据/支付、破坏性/不可逆操作或必须真人硬件验收时找我。

先给我：
1. 最终 branch 和 exact HEAD；
2. 五作业 CI run ID 与逐项结论；
3. 四个 production Compose marker；
4. 后补的 `m3_verified_head`、`m3_verified_ci_run`、`m3_verification_result`；
5. `main` 未修改/未合并的确认。
```
