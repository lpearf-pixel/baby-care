# M0 Repository and Delivery Foundation Design

Status: approved for implementation by the user on 2026-08-13.
Scope: M0 only.
Repository: `lpearf-pixel/baby-care`
Branch: `codex/m0-foundation`

## Goal

Create an autonomous-development-ready Baby Care skeleton that can be built, tested, diagnosed, and packaged on GitHub public runners without depending on the user's local terminal.

## Product constraints

- Baby Care remains independent from Baby Guardian.
- Birth Ready is Web/PWA first for iPhone, Android, and Mac browsers.
- The development baby nickname is `xiangxiang`.
- The application timezone default is `Asia/Shanghai`.
- No WeChat Mini Program or native mobile app in M0.
- No production cloud server is required in M0.
- M0 must not implement care-domain assumptions that belong to M2. Before M2, collect real family care habits from the user.

## Technical baseline

Use a TypeScript npm-workspaces monorepo on Node.js 22.

```text
apps/web                 React + Vite Web/PWA shell
apps/api                 Fastify API
packages/shared          shared contracts/config/diagnostics
infra/postgres           SQL migrations and database bootstrap
tools                    CI/diagnostic utilities
.github/workflows        GitHub public-runner verification
```

Database: PostgreSQL 16.
Tests: Vitest for unit/integration behavior.
Containerization: Docker Compose with `web`, `api`, and `db` services.

Dependencies are pinned to exact versions in package manifests. A lockfile is desirable once an internet-enabled development environment can generate it; M0 CI must not require a pre-existing lockfile.

## API health contract

Expose machine-readable endpoints:

- `GET /health/live` returns process liveness without requiring PostgreSQL.
- `GET /health/ready` verifies configuration and PostgreSQL connectivity.

Success shape:

```json
{
  "status": "ok",
  "service": "baby-care-api",
  "checks": {"database": "ok"}
}
```

Readiness failure returns HTTP 503 with a compact error code and no secret values.

## Configuration contract

All runtime configuration comes from environment variables with one validation boundary. Required production/runtime variables are documented in `.env.example`. Invalid values fail startup with a structured `CONFIG_INVALID` diagnostic.

Minimum configuration:

- `NODE_ENV`
- `API_HOST`
- `API_PORT`
- `DATABASE_URL`
- `APP_TIMEZONE` (default `Asia/Shanghai`)
- `BABY_DISPLAY_NAME` (default `xiangxiang`)

## Structured diagnostics contract

Application and CI diagnostics use one JSON-line event shape:

```text
timestamp
level
event_code
component
trace_id (when available)
message
expected (optional)
actual (optional)
evidence_pointer (optional)
```

Do not emit passwords, connection credentials, raw authorization headers, or other secrets.

CI stores full raw logs as artifacts but model/debugging workflows read compact diagnostics first.

On a failed verification job, `tools/collect-diagnostics.mjs` creates:

```text
diagnostics/latest/summary.json
diagnostics/latest/environment.json
diagnostics/latest/changed-files.txt
diagnostics/latest/artifact-index.json
```

If raw command logs exist under `diagnostics/raw/`, the artifact index references them; the summary includes only bounded tails rather than entire logs.

## Web/PWA shell

M0 does not implement care forms. It provides:

- responsive mobile-first shell
- installable manifest
- service worker for application-shell caching
- visible development baby name `xiangxiang`
- API status indicator
- offline-safe shell page

No medical or care recommendation logic is added.

## PostgreSQL foundation

M0 creates only infrastructure metadata, not family/care domain tables. The first migration creates `schema_migrations` and an `app_meta` key/value table sufficient to prove migration/database health.

A migration runner must be idempotent and record applied migration filenames.

## Docker Compose

Compose must define:

- PostgreSQL 16 with a health check
- API depending on healthy DB
- Web depending on API

`docker compose config` must validate without secrets committed to the repository.

## CI gates

GitHub public runners run:

1. dependency installation
2. typecheck
3. unit tests
4. web/API build
5. PostgreSQL integration tests using a service container
6. migration idempotency verification
7. Docker Compose model validation

On failure, collect and upload the compact diagnostic pack plus raw logs.

Browser E2E is part of the full Birth Ready release gate but is deferred until a user-facing care flow exists; M0 verifies the web shell by build/unit behavior to avoid spending browser-install cost before it provides value.

## Token/cost efficiency

- Focused tests first; full gate at M0 boundary.
- Structured failure events before raw logs.
- Never make full-log reading the default.
- CI diagnostic pack must identify failing command/component and point to evidence.
- High-reasoning review is reserved for architecture/release boundaries, not mechanical fixes.

## M0 acceptance gate

M0 is complete only when:

- repository structure exists and builds on GitHub public runner
- unit tests pass
- PostgreSQL readiness/integration tests pass
- migrations can run twice without reapplying
- web shell builds
- Compose model validates
- `/health/live` and `/health/ready` are machine-readable
- a forced CI failure can produce a compact diagnostic pack
- no user-side local command is required for ordinary verification
