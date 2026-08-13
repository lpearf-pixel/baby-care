# M0 Repository and Delivery Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the autonomous-development-ready Web/PWA + API + PostgreSQL + CI foundation for Baby Care.

**Architecture:** Use an npm-workspaces TypeScript monorepo. The API owns configuration, PostgreSQL readiness, and migrations; the Web app is a responsive PWA shell; shared code owns structured diagnostics. GitHub Actions is the authoritative software verification environment and emits compact diagnostic artifacts on failure.

**Tech Stack:** Node.js 22, TypeScript 5.x, React, Vite, Fastify, PostgreSQL 16, Vitest, Docker Compose, GitHub Actions.

## Global Constraints

- Read `/agent.md` before implementation.
- Baby nickname is `xiangxiang`; timezone default is `Asia/Shanghai`.
- Do not implement M2 care-domain assumptions.
- Baby Care must remain independently deployable from Baby Guardian.
- Use structured compact diagnostics before raw logs.
- Use focused tests before milestone-wide verification.
- Do not require the user to run ordinary verification locally.

---

## File structure

```text
package.json                         workspace scripts and exact dependency versions
tsconfig.base.json                  shared TypeScript compiler baseline
.env.example                        documented runtime configuration
apps/api/package.json               API package
apps/api/src/config.ts              environment validation
apps/api/src/db.ts                  PostgreSQL pool/readiness
apps/api/src/health.ts              health response builders
apps/api/src/server.ts              Fastify server assembly
apps/api/src/index.ts               process entry point
apps/api/src/migrate.ts             idempotent migration runner
apps/api/test/config.test.ts        config behavior
apps/api/test/health.test.ts        liveness/readiness behavior
apps/api/test/migrations.test.ts    PostgreSQL migration integration
apps/web/package.json               web package
apps/web/index.html                 Vite entry document
apps/web/src/main.tsx               responsive shell
apps/web/src/app.tsx                PWA status view
apps/web/src/app.test.tsx           shell behavior
apps/web/src/styles.css             mobile-first presentation
apps/web/public/manifest.webmanifest installable PWA metadata
apps/web/public/sw.js               app-shell service worker
packages/shared/package.json        shared package
packages/shared/src/diagnostics.ts  structured diagnostic event contract
packages/shared/test/diagnostics.test.ts diagnostic redaction/shape tests
infra/postgres/migrations/0001_foundation.sql metadata schema
tools/collect-diagnostics.mjs       bounded CI diagnostic pack collector
tools/collect-diagnostics.test.mjs  collector tests
docker-compose.yml                  local stack
apps/api/Dockerfile                 API image
apps/web/Dockerfile                 web image
.github/workflows/verify.yml        public-runner M0 gate
```

### Task 1: Workspace and structured diagnostics

**Files:** root workspace files, `packages/shared/**`, `tools/collect-diagnostics*`.

**Interfaces:**
- Produces `createDiagnosticEvent(input)` returning a JSON-safe event with secret fields excluded.
- Produces `npm run diagnostics:collect -- --status <status> --component <component>`.

- [ ] Write `packages/shared/test/diagnostics.test.ts` first, asserting timestamp/event/component fields and that secret-like keys are rejected/redacted.
- [ ] Run the focused shared test and verify RED because the production module does not exist.
- [ ] Implement the minimal diagnostics contract and workspace TypeScript config.
- [ ] Re-run the focused test and verify GREEN.
- [ ] Write `tools/collect-diagnostics.test.mjs` first, asserting bounded raw-log tails and required diagnostic files.
- [ ] Run it and verify RED.
- [ ] Implement `tools/collect-diagnostics.mjs`; re-run and verify GREEN.

### Task 2: API configuration, health, PostgreSQL, and migrations

**Files:** `apps/api/**`, `infra/postgres/migrations/0001_foundation.sql`.

**Interfaces:**
- `loadConfig(env)` returns validated immutable runtime config.
- `buildServer(deps)` returns a Fastify instance with `/health/live` and `/health/ready`.
- `runMigrations(pool, migrationsDir)` applies each SQL file once.

- [ ] Write config tests first for defaults (`xiangxiang`, `Asia/Shanghai`) and invalid port/database settings; verify RED.
- [ ] Implement `loadConfig`; verify GREEN.
- [ ] Write health tests first: liveness must not call DB; readiness success returns 200; readiness DB failure returns 503 with compact error code; verify RED.
- [ ] Implement health/server assembly; verify GREEN.
- [ ] Write PostgreSQL integration test first to run migrations twice and assert one application record per migration; verify RED in the CI/PostgreSQL environment.
- [ ] Implement DB pool and migration runner plus `0001_foundation.sql`; verify GREEN in PostgreSQL integration gate.

### Task 3: Responsive PWA shell

**Files:** `apps/web/**`.

**Interfaces:**
- Web shell renders `xiangxiang`, Baby Care title, API status, and an offline-safe message.
- Manifest and service worker are static PWA assets.

- [ ] Write the web shell component test first, asserting `xiangxiang` and status labels; verify RED.
- [ ] Implement minimal React shell and mobile-first CSS; verify GREEN.
- [ ] Add manifest and service worker registration.
- [ ] Run web tests and production build.

### Task 4: Container and autonomous CI delivery gate

**Files:** `Dockerfile`s, `docker-compose.yml`, `.env.example`, `.github/workflows/verify.yml`, package scripts.

**Interfaces:**
- `npm run verify:focused` runs unit/type/build checks without PostgreSQL.
- `npm run test:integration` runs PostgreSQL migration/readiness integration.
- CI uploads `m0-diagnostics-*` artifacts on failure.

- [ ] Add `.env.example` and Compose configuration using no committed secrets.
- [ ] Add API and Web Dockerfiles.
- [ ] Add workflow with PostgreSQL 16 service, focused gate, integration gate, and `docker compose config`.
- [ ] Ensure each verification command tees bounded raw logs under `diagnostics/raw/`.
- [ ] On `failure()`, run diagnostic collector and upload compact diagnostics plus raw logs.
- [ ] Run all locally available focused tests/typechecks/builds in the sandbox.
- [ ] Push branch and let GitHub public-runner CI execute the authoritative integration gate.
- [ ] Inspect job summaries first; only inspect targeted raw log ranges when structured evidence is insufficient.
- [ ] Repair failures and rerun until the M0 gate is green.

## Plan self-review

Coverage: all M0 deliverables from `docs/PLAN.md` are represented. Browser E2E is intentionally deferred per the M0 design because no care interaction exists yet. No care-domain defaults beyond the approved nickname/timezone are introduced. Interfaces are stable enough for M1 to build on without Guardian coupling.
