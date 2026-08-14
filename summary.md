# Baby Care Work Handoff Summary

Updated: 2026-08-14
Repository: `lpearf-pixel/baby-care`

This file is the short handoff for a fresh Work/chat. Read it together with `agent.md`, `docs/PLAN.md`, and `.agent/current-milestone.json` before planning or coding.

## 1. Current authoritative state

- Current completed milestone: **M2 — Care Recording MVP**.
- Next milestone: **M3 — Care Workspace**, status **ready for design**.
- M1 authoritative baseline: `codex/m1-family-baby-foundation @ 76d578a464ec2ab1f8eb1f8f33d8e429caff10ba`.
- M1 authoritative CI: `31707486985` — 5/5 PASS.
- M2 authoritative implementation branch: `codex/m2-care-recording-implementation`.
- M2 verified implementation head before this handoff-only documentation commit: `222ab8b30dc8e14b3ae95befa413a654760338bd`.
- M2 final authoritative CI on that head: `31768875691` — static / unit / PostgreSQL integration / production build / production Compose smoke all PASS.
- M2 Draft PR: **#4 — `M2: care recording MVP`**, base `codex/m1-family-baby-foundation`.
- `main` has not been modified or merged for M2. Keep PR #4 Draft unless the user explicitly approves merge/integration.

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

## 4. M3 starting scope

M3 is **Care Workspace**, not Guardian integration.

M3 should design and then improve, using the existing M2 facts rather than redefining them:

- care timeline comprehension;
- family handoff / 交接班 workflow;
- day/night operational UX;
- correction/history usability;
- current-state comprehension for sleep-deprived caregivers;
- keeping common actions reachable in roughly 2-3 taps.

Do not begin M3 implementation before a dedicated M3 design/spec is written and approved.

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

## 7. Autonomous development rules to preserve

- Read `agent.md` first, then this file, `docs/PLAN.md`, `.agent/current-milestone.json`, and only the relevant approved spec/plan.
- Use RED -> GREEN -> focused tests -> integration -> exact-head CI.
- Use GitHub public runners for ordinary verification.
- Diagnose CI from compact structured evidence before loading raw logs.
- Continue reversible work autonomously after spec approval.
- Do not ask the user to run ordinary local commands when CI/connector/repository automation can do the job.
- Do not modify/merge `main` without explicit user approval.
- Preserve user work; do not reset/overwrite unrelated changes.
- Only stop for major product direction, credentials/payment, destructive/irreversible actions, or real hardware/family acceptance that automation cannot reproduce.

## 8. Fresh Work entry point

The next Work should begin with **M3 design**, not M2 implementation and not Guardian coding.

Recommended first sequence:

1. Read the authoritative state files.
2. Verify live branch/PR/CI state without changing anything.
3. Review the existing M2 Web/PWA workspace and M2 contracts only as needed.
4. Draft the M3 Care Workspace design around timeline comprehension, handoff, day/night UX, and correction/history usability.
5. Preserve all M2 semantics above.
6. Explicitly keep Guardian/audio/AI outside M3 unless the user separately approves a scope change.
7. Present the M3 design for approval before implementation.

## 9. Copy/paste prompt for the next Work

```text
你现在接管长期项目 `lpearf-pixel/baby-care`。

先不要直接开发。先读取并核验真实仓库状态：

- `agent.md`
- `summary.md`
- `docs/PLAN.md`
- `.agent/current-milestone.json`
- `docs/superpowers/specs/2026-08-13-m2-care-recording-mvp-design.md`
- `docs/superpowers/plans/2026-08-13-m2-care-recording-mvp-reviewed.md`
- Draft PR #4

当前权威 M2 分支是 `codex/m2-care-recording-implementation`。M2 Care Recording MVP 已完成并通过最终 5/5 CI；不要重新实现 M2，不要修改或合并 `main`。

你的当前任务是开始 **M3 Care Workspace**：先做设计，不直接写代码。重点是 timeline comprehension、family handoff/交接班、day/night operational UX、correction/history usability，并保持常用操作适合单手、睡眠不足场景。

必须保留 M2 已确定的语义：奶瓶容量不等于摄入量；瓶喂实际 ml；母乳瓶喂与配方奶分开；亲喂只记录总时长、不做左右乳计时、不推算 ml；rolling 24h；warning 显式确认；edit 保留 revision；undo=void；actor/family/baby/source 由服务端认证上下文派生；药物只记录事实，不推荐/计算剂量。

`baby-monitor-local`/Guardian 是独立系统。小米 MJSXJ17CM 音频已经被识别为未来 Guardian 多模态输入候选，但当前 live audio track 尚需真机 probe。不要把 Guardian/JoyAI/Qwen/自动喂奶识别直接塞进 M3；除非我明确批准新的集成设计。

工作方式：普通可逆工作自动继续；使用 GitHub 公共 runner；失败自行诊断修复重跑；不要让我执行普通本地命令；只在重大产品方向、凭据/支付、破坏性/不可逆操作或必须真人硬件验收时找我。规格批准后继续开发、测试、CI、review，直到当前里程碑计划结束。

先给我：
1. 真实仓库/分支/PR/CI核验结果；
2. M3 设计输入和你认为需要解决的核心交互问题；
3. 一版可审核的 M3 设计规格。
```
