# M0 Delivery Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal reproducible Web/PWA + API + PostgreSQL + diagnostics + CI foundation for `baby-care` so later milestones can be developed and verified without routine user-terminal intervention.

**Architecture:** A pnpm TypeScript monorepo hosts a React/Vite Web shell, Fastify API, framework-free shared contracts/domain packages, and structured observability helpers. PostgreSQL is local/CI authoritative storage, Docker Compose is the portable runtime envelope, and GitHub Actions public runners execute segmented gates with compact diagnostic artifacts.

**Tech Stack:** Node.js 24-compatible, pnpm workspaces, TypeScript strict mode, React, Vite, Fastify, Zod, Vitest, PostgreSQL 16+, Drizzle ORM/drizzle-kit, Docker Compose, GitHub Actions.

## Global Constraints

- Read `/agent.md` before work.
- Work on `codex/m0-delivery-foundation`, not `main`.
- M0 must not introduce feeding/diaper/sleep/care-domain defaults; M2 remains gated on real family habits.
- Web/PWA supports iPhone, Android, and Mac browser layouts.
- Use GitHub public runners for general CI.
- Debug from structured diagnostic evidence first; full logs are fallback only.
- Long work is segmented and each segment leaves Git-visible state plus verification evidence.
- Secrets must not be committed.
- Baby development/display nickname is `xiangxiang`.

---

## File Structure

Create or maintain the following responsibilities:

```text
package.json                         workspace commands only
pnpm-workspace.yaml                  workspace package discovery
tsconfig.base.json                   shared strict TypeScript baseline
eslint.config.mjs                    repository lint rules
.env.example                         non-secret local configuration contract

apps/web/
  package.json                       Web scripts/dependencies
  index.html                         Vite entry document
  vite.config.ts                     Vite config and dev API proxy
  src/main.tsx                       React bootstrap
  src/App.tsx                        minimal health/status shell
  src/app.css                        responsive system-theme styles
  public/manifest.webmanifest        PWA install metadata
  src/App.test.tsx                   Web contract test

apps/api/
  package.json                       API scripts/dependencies
  src/app.ts                         Fastify app factory
  src/server.ts                      process bootstrap only
  src/config.ts                      environment parsing
  src/db.ts                          PostgreSQL/Drizzle connection owner
  src/routes/health.ts               `/health` route
  test/health.integration.test.ts    health/database integration behavior

packages/contracts/
  package.json
  src/index.ts                       exports
  src/health.ts                      Zod health-response contract
  test/health.test.ts                contract tests

packages/domain/
  package.json
  src/index.ts                       future-safe framework-free package marker
  test/smoke.test.ts                 package isolation smoke test

packages/observability/
  package.json
  src/index.ts                       exports
  src/diagnostic-event.ts            diagnostic schema/helpers
  src/trace-id.ts                    trace validation/generation
  test/diagnostic-event.test.ts      diagnostic contract tests
  test/trace-id.test.ts              trace behavior tests

infra/docker/
  api.Dockerfile                     API production image
  web.Dockerfile                     Web production image
  nginx.conf                         static Web + `/api` reverse proxy

compose.yaml                         postgres/api/web runtime

drizzle.config.ts                   migration configuration
migrations/                          generated SQL migration directory

scripts/
  compose-smoke.mjs                  deterministic Compose health probe
  collect-diagnostics.mjs            compact CI diagnostic pack writer

.github/workflows/ci.yml             segmented public-runner CI

README.md                            minimal start/verify documentation
```

---

### Task 1: Workspace and shared contract foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.mjs`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/health.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/test/health.test.ts`
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/smoke.test.ts`

**Interfaces:**
- Produces: `HealthResponseSchema`, `HealthResponse`, workspace-wide `lint`, `typecheck`, and `test` commands.

- [ ] **Step 1: Create workspace manifests/config with no production behavior.**
- [ ] **Step 2: Write `packages/contracts/test/health.test.ts` first.** Assert that the contract accepts exactly `ok` and `degraded` forms and rejects unknown database states.
- [ ] **Step 3: Run the focused contract test and verify RED because `HealthResponseSchema` does not exist.**
- [ ] **Step 4: Implement `HealthResponseSchema` using Zod and export the inferred TypeScript type.**
- [ ] **Step 5: Run focused tests and workspace typecheck; verify GREEN.**
- [ ] **Step 6: Add a domain-package smoke test proving it has no framework/runtime dependency.**
- [ ] **Step 7: Commit `chore: establish TypeScript workspace contracts`.**

Expected verification:

```bash
pnpm --filter @baby-care/contracts test
pnpm --filter @baby-care/domain test
pnpm typecheck
```

---

### Task 2: Structured observability and trace IDs

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/src/diagnostic-event.ts`
- Create: `packages/observability/src/trace-id.ts`
- Create: `packages/observability/src/index.ts`
- Create: `packages/observability/test/diagnostic-event.test.ts`
- Create: `packages/observability/test/trace-id.test.ts`

**Interfaces:**
- Produces: `DiagnosticEventSchema`, `DiagnosticEvent`, `createDiagnosticEvent()`, `isValidTraceId()`, `resolveTraceId()`.
- `resolveTraceId(candidate?: string): string` preserves a valid caller value and otherwise returns a new safe identifier.

- [ ] **Step 1: Write tests for valid structured diagnostic events and rejection of missing `event_code`/`trace_id`.**
- [ ] **Step 2: Run focused tests and verify RED.**
- [ ] **Step 3: Implement versioned diagnostic schema/helper.**
- [ ] **Step 4: Write trace tests: preserve safe caller trace ID, reject whitespace/control/oversized values, generate UUID-like fallback.**
- [ ] **Step 5: Run and verify RED for trace helper.**
- [ ] **Step 6: Implement trace helper using Node crypto UUID generation.**
- [ ] **Step 7: Run observability tests/typecheck and verify GREEN.**
- [ ] **Step 8: Commit `feat: add structured diagnostics and trace ids`.**

---

### Task 3: Fastify API and PostgreSQL-aware health endpoint

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/db.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/test/health.integration.test.ts`
- Create: `drizzle.config.ts`
- Create: `migrations/.gitkeep`

**Interfaces:**
- Consumes: `HealthResponseSchema`, `resolveTraceId()`, diagnostic event helpers.
- Produces: `buildApp(options?)`, `GET /health`, DB connectivity abstraction `checkDatabase(): Promise<boolean>`.

- [ ] **Step 1: Write integration tests before implementation.** Cases: healthy DB -> 200/`database=ok`; unavailable DB -> 503/`database=unavailable`; `x-trace-id` is preserved in response header.
- [ ] **Step 2: Run focused API integration test and verify RED because app factory does not exist.**
- [ ] **Step 3: Implement strict environment parsing and DB connection owner.**
- [ ] **Step 4: Implement `buildApp()` with request trace hook and health route dependency injection so failure behavior can be tested without network mocks.**
- [ ] **Step 5: Validate all outgoing health responses against `HealthResponseSchema` in tests.**
- [ ] **Step 6: Run focused integration tests and API typecheck; verify GREEN.**
- [ ] **Step 7: Add a no-op initial migration boundary only; do not create care tables.**
- [ ] **Step 8: Commit `feat: add PostgreSQL-aware health API`.**

---

### Task 4: Responsive Web/PWA shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/app.css`
- Create: `apps/web/src/App.test.tsx`
- Create: `apps/web/public/manifest.webmanifest`

**Interfaces:**
- Consumes: API `/api/health` contract.
- Produces: responsive installable shell showing `xiangxiang` and backend availability.

- [ ] **Step 1: Write component test first: renders product identity and `xiangxiang`; shows loading then healthy/degraded status from injected/fetched health response.**
- [ ] **Step 2: Run Web focused test and verify RED.**
- [ ] **Step 3: Implement minimal React shell and health client.**
- [ ] **Step 4: Add responsive CSS using system appearance; no care-domain UI.**
- [ ] **Step 5: Add PWA manifest metadata.**
- [ ] **Step 6: Run Web tests/typecheck/build; verify GREEN.**
- [ ] **Step 7: Commit `feat: add responsive baby-care PWA shell`.**

---

### Task 5: Production containers and Compose smoke path

**Files:**
- Create: `infra/docker/api.Dockerfile`
- Create: `infra/docker/web.Dockerfile`
- Create: `infra/docker/nginx.conf`
- Create: `compose.yaml`
- Create: `scripts/compose-smoke.mjs`
- Modify: `package.json` workspace scripts

**Interfaces:**
- Produces: `docker compose up -d --build` local stack; Web proxies `/api` to API; PostgreSQL remains internal except optional localhost development port.

- [ ] **Step 1: Write `scripts/compose-smoke.mjs` to fail unless Web and API health endpoints become ready within bounded retries.**
- [ ] **Step 2: Run script without stack and verify expected failure.**
- [ ] **Step 3: Implement Dockerfiles, Nginx proxy, Compose services/health checks.**
- [ ] **Step 4: Build/start Compose.**
- [ ] **Step 5: Run smoke script and verify GREEN.**
- [ ] **Step 6: Tear down with volumes only in disposable test context.**
- [ ] **Step 7: Commit `build: add portable Docker Compose runtime`.**

---

### Task 6: Compact CI diagnostics and GitHub Actions

**Files:**
- Create: `scripts/collect-diagnostics.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**
- Produces: `diagnostics/latest/summary.json`, `environment.json`, `artifact-index.json`, plus optional focused evidence files.

- [ ] **Step 1: Write a deterministic script-level test or fixture invocation that generates a compact failure summary from environment inputs.**
- [ ] **Step 2: Verify RED before collector implementation.**
- [ ] **Step 3: Implement collector with hard limits on captured text; never ingest an unbounded raw log.**
- [ ] **Step 4: Create segmented CI jobs: static, unit, integration, build, compose-smoke.**
- [ ] **Step 5: On failure, run collector and upload only compact diagnostics plus explicitly bounded relevant artifacts; raw job logs remain GitHub-native fallback.**
- [ ] **Step 6: Push branch and inspect job/step status first; fetch full logs only if compact evidence is insufficient.**
- [ ] **Step 7: Repair CI until all gates pass.**
- [ ] **Step 8: Commit `ci: add segmented gates and compact diagnostics`.**

---

### Task 7: M0 release gate and documentation

**Files:**
- Create/Modify: `README.md`
- Modify: `docs/PLAN.md`
- Create: `.agent/current-milestone.json` only if it reduces repeated context reads now

**Interfaces:**
- Produces: verifiable M0 handoff and next milestone state.

- [ ] **Step 1: Document only prerequisites, `pnpm install`, local non-Docker verify, `docker compose up -d --build`, and shutdown commands.**
- [ ] **Step 2: Run repository release gate:**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm -r build
docker compose up -d --build
node scripts/compose-smoke.mjs
docker compose down
```

- [ ] **Step 3: Confirm no care-domain tables/defaults exist and no secrets are committed.**
- [ ] **Step 4: Update `docs/PLAN.md` to mark M0 complete only after CI is green.**
- [ ] **Step 5: Create/update `.agent/current-milestone.json` with compact M1 next-step state if useful.**
- [ ] **Step 6: Commit `docs: complete M0 delivery foundation gate`.**
- [ ] **Step 7: Perform final diff review and create a draft PR to `main`; do not merge without explicit user approval.**

## Plan Self-Review

- Spec coverage: workspace, Web/PWA, API, PostgreSQL, diagnostics, Compose, CI, segmented execution, token-efficient failure evidence, and release gate are each mapped to a task.
- Scope: no M2 care-recording assumptions or Guardian/JoyAI implementation appears in M0.
- Type/interface consistency: health contract is defined first and consumed by API/Web; observability helpers are defined before API tracing.
- Placeholder scan: no `TBD`/`TODO` implementation placeholders are permitted.
- Verification: every production behavior task begins with a failing test or bounded failing probe before implementation.
