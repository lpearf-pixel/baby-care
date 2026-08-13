# M0 Delivery Foundation Design

Status: approved from conversation, written for implementation
Date: 2026-08-13
Milestone: M0 Repository / Delivery Foundation
Branch: `codex/m0-delivery-foundation`

## Goal

Create the smallest reliable foundation that lets `baby-care` evolve through autonomous, segmented development without depending on the user's local terminal for routine verification.

M0 must establish a Web/PWA shell, API, PostgreSQL integration, Docker Compose local deployment, structured diagnostics, and GitHub Actions CI. It must not prematurely model feeding/care behavior; M2 remains gated on the family's real care habits.

## Architecture

Use a TypeScript monorepo with clear package boundaries:

```text
apps/web                  React + Vite responsive Web/PWA shell
apps/api                  Node + TypeScript HTTP API
packages/contracts        shared API/event schemas
packages/domain           framework-free domain primitives
packages/observability    structured diagnostic events
infra/docker              runtime/container support
infra/backup              backup/restore scripts later in M0/M4
.github/workflows         public-runner CI
diagnostics               generated compact diagnostic artifacts
```

PostgreSQL is the authoritative transactional store. M0 creates only infrastructure-level persistence/migration capability and health verification; it does not define care-domain tables.

## Technology Choices

- Node.js: 24 LTS-compatible runtime
- Package manager: pnpm workspace
- Language: TypeScript with strict mode
- Web: React + Vite
- API: Fastify
- Validation/contracts: Zod
- Testing: Vitest
- Browser E2E: Playwright, introduced when browser behavior exists
- Database: PostgreSQL 16+
- DB access/migrations: Drizzle ORM + drizzle-kit
- Local orchestration: Docker Compose
- CI: GitHub Actions public Ubuntu runners

The implementation should stay compatible with macOS/Apple Silicon for local use.

## Core Runtime Contracts

### API health

`GET /health` returns a stable JSON contract:

```json
{
  "status": "ok",
  "service": "baby-care-api",
  "database": "ok",
  "timestamp": "2026-08-13T00:00:00.000Z"
}
```

When the database is unavailable the endpoint returns HTTP 503 with:

```json
{
  "status": "degraded",
  "service": "baby-care-api",
  "database": "unavailable",
  "timestamp": "2026-08-13T00:00:00.000Z"
}
```

### Structured diagnostics

All application-level diagnostic events use a versioned shape with at least:

- `schema_version`
- `timestamp`
- `trace_id`
- `component`
- `event_code`
- `severity`
- `message`
- optional `expected`
- optional `actual`
- optional `error_class`
- optional `evidence_pointer`

Diagnostics are JSON lines and must be machine-searchable by `trace_id` or `event_code`.

### Request tracing

Every API request has a trace ID. If the caller supplies a valid `x-trace-id`, preserve it; otherwise generate one. Return the trace ID in the response header.

## Web/PWA Shell

M0 Web is intentionally minimal. It must:

- render on iPhone-size, Android-size, and desktop viewports
- show product name and development baby nickname `xiangxiang`
- call `/api/health` and display backend availability without exposing internal details
- include PWA manifest and installable metadata
- be usable in light and dark system appearance

No care recording UX is implemented in M0.

## Configuration

Use environment variables with checked examples. Secrets are never committed.

Minimum configuration:

- API bind host/port
- web API base URL where needed
- PostgreSQL URL
- log/diagnostic level

Local Compose should use internal service DNS names, not hard-coded host machine addresses.

## Docker Compose

One command should bring up:

- PostgreSQL
- API
- Web

Health checks must make dependency state visible. The Web/API containers must not require source code mounted from arbitrary host paths in CI.

## CI and Test Strategy

M0 CI uses GitHub public runners and runs in segmented jobs so a failure is easy to isolate:

1. static: install, lint, typecheck
2. unit: unit/contract tests
3. integration: PostgreSQL + API integration tests
4. build: web/API production builds
5. compose-smoke: build/start Compose and probe health
6. diagnostics: always emit a compact machine-readable failure summary artifact when a job fails

Routine debugging starts from job/step status and the compact diagnostic artifact. Full raw logs are fallback evidence only.

## Diagnostic Artifact Contract

CI should create a small `diagnostics/latest/` payload containing applicable files:

```text
summary.json
failing-tests.json
changed-files.txt
trace.jsonl
environment.json
artifact-index.json
```

M0 does not need sophisticated automatic root-cause analysis. It needs a stable structure that later agents can consume without reading entire logs.

## Autonomous Segmentation Rule

Long implementation work is split into independently verifiable segments:

- M0-A spec and plan
- M0-B monorepo/web/api foundation
- M0-C PostgreSQL/migrations/health
- M0-D structured diagnostics
- M0-E Docker Compose
- M0-F GitHub Actions CI
- M0-G release gate

Each segment must leave Git-visible state and verification evidence before the next segment begins. Ordinary reversible failures are repaired without asking the user to run local commands.

## Security and Privacy

- Do not store real baby medical/care data in M0 fixtures.
- Use `xiangxiang` only as a development/display nickname.
- Do not expose database credentials to the browser bundle.
- Do not publish internal traces containing secrets.
- Keep Guardian/video functionality out of M0.

## Explicit Non-Goals

M0 does not implement:

- feeding, diaper, sleep, cry, spit-up, weight workflows
- Dad/Mom/Nanny authorization rules beyond future-compatible scaffolding
- Guardian Adapter
- JoyAI/Qwen runtime
- production cloud hosting
- Redis, queues, Kubernetes, service mesh, external observability SaaS
- content generation

## Acceptance Criteria

M0 is complete only when all applicable evidence exists:

1. Workspace installs reproducibly with a lockfile.
2. Unit/contract tests pass.
3. API integration test proves `GET /health` reports PostgreSQL state correctly.
4. Web and API production builds pass.
5. Docker Compose starts PostgreSQL, API, and Web and the health probe succeeds.
6. GitHub Actions public-runner workflow executes the automated gates.
7. A failed-test fixture or controlled failure path demonstrates compact structured diagnostic output without requiring full-log parsing.
8. README documents only the minimal local start/verify commands.
9. No M2 care-domain assumptions are introduced.

## Self-Review

- No placeholder requirements remain.
- M0 scope is intentionally infrastructure-only and does not violate the M2 real-care-habits gate.
- `baby-care` remains independent from `baby-monitor-local`.
- Diagnostics and CI are designed to reduce token/log consumption rather than add a heavyweight observability platform.
- The architecture can later add `packages/guardian-adapter` and an M2 Mac Agent Orchestrator without rewriting the care application.
