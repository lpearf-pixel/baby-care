# M4 Birth Ready Operations And Data Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved M4 Birth Ready operations loop: Dad/Mom-only complete family export, private atomic PostgreSQL backup, fail-closed isolated restore with restored-session revocation, and a synthetic production-mode family simulation that proves the recovered care workspace.

**Architecture:** Keep Baby Care API and PostgreSQL authoritative. Build the family export from one bounded `REPEATABLE READ READ ONLY` snapshot, add only a family-admin Web download surface, and keep backup/restore outside HTTP in a new `@baby-care/operations` package plus fixed operator CLI. The host CLI invokes PostgreSQL tools only inside named PostgreSQL 16 Compose services through a narrow subprocess adapter; restore targets a separately identified empty cluster and is verified by fixed SQL plus the existing API read models. Production Compose supplies disposable source/restore services for the final closed-loop proof.

**Tech Stack:** Node 24+, TypeScript, pnpm 10.17.1, Fastify, PostgreSQL 16, `pg_dump`/`pg_restore`/`psql`, Drizzle ORM/Kit, Zod, React/Vite PWA, Vitest, Testing Library, Docker Compose, GitHub Actions public runners.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-17-m4-birth-ready-operations-data-safety-design.md`.
- Implementation branch: `codex/m4-birth-ready-operations` at plan baseline `2f92709`; its verified product baseline is M3 exact head `52b042a66122464af338a2b4931315d92dff0965`, CI `31959895049` 5/5 PASS.
- Do not modify, merge, or retarget `main`; M3 Draft PR #5 stays independent and unmerged.
- Task commits are local by default. Any `git push`, Draft PR creation/update, or exact-head GitHub Actions run that requires remote mutation is conditional on separate explicit authorization.
- `baby-monitor-local` training, camera/audio work, Guardian, wake/ASR/TTS, JoyAI/Qwen, and future Voice Care Gateway work do not block M4 and are not part of this plan.
- Preserve all M2/M3 meanings: consumed bottle ml is intake, capacity is metadata, expressed milk/formula remain distinct, breastfeeding is minutes only, medication is an administered fact only, edit is append-only, undo is void-based, and reminders never create handoff checkpoints.
- Family export is private and complete, not anonymized. Backup is a full sensitive database artifact. Neither may enter Git, CI artifacts, diagnostics, screenshots, fixtures, or normal logs.
- Only `family_admin` may export. Nanny/caregiver cannot export, run operator commands, or see operator state.
- Export queries use one PostgreSQL client and one `REPEATABLE READ READ ONLY` transaction. No pool query may occur inside the snapshot.
- Export payloads are validated and size-checked before response headers/body are sent. Default limit is exactly `33_554_432` bytes; overflow returns `export_too_large` without truncation.
- Backup output must be a real owner-private directory. Reject symlink ancestors, non-regular files, partial bundles, and non-atomic finalization.
- Restore never uses `--clean`, `--create`, role changes, arbitrary operator SQL, or an in-place/source target. It requires a different PostgreSQL cluster identity and an empty destination.
- Restored sessions are revoked transactionally before a restored target is usable. No care, revision, handoff, reminder, user, or audit history is rewritten during sanitation.
- CLI output and compact diagnostics contain stable codes/aggregate markers only: no care values, names, notes, medication facts, paths, filenames, database coordinates, connection strings, hashes from live artifacts, raw commands, catalogues, SQL output, or raw errors.
- Every implementation task follows RED -> observed expected failure -> minimal GREEN -> focused regression -> review -> local commit. Do not weaken assertions or skip enabled PostgreSQL/Compose tests to get GREEN.
- If local PostgreSQL 16 or Docker is unavailable, keep integration tests enabled, record the environment limitation, and require exact-head CI before the dependent gate is accepted.
- A real-family export, real backup destination, real restore, hardware test, and family walkthrough remain human-gated. Automated work uses generated data and disposable directories/databases only.

---

## Execution Preconditions

Before Task 1:

```bash
cd /workspace/scratch/102cf8956cca/baby-care-m3
git branch --show-current
git merge-base --is-ancestor 52b042a66122464af338a2b4931315d92dff0965 HEAD
git status --short
```

Expected: branch `codex/m4-birth-ready-operations`, ancestry exits 0, and there are no unrelated changes. Do not reset user work. Read `agent.md`, `summary.md`, `docs/PLAN.md`, `.agent/current-milestone.json`, the approved M4 spec, and this plan before implementation.

## Architecture And Interface Map

### Family export boundary

```ts
export const FamilyExportSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  generatedAt: OffsetDateTimeSchema,
  family: ExportFamilySchema,
  baby: ExportBabySchema,
  members: z.array(ExportMemberSchema),
  careEvents: z.array(ExportCareEventSchema),
  careRevisions: z.array(ExportCareRevisionSchema),
  handoffCheckpoints: z.array(ExportHandoffCheckpointSchema),
  handoffReminderRules: z.array(ExportHandoffReminderRuleSchema),
}).strict();

export interface FamilyExportService {
  exportFamily(actor: AuthContext, generatedAt: Date): Promise<{
    document: FamilyExportV1;
    serialized: Buffer;
  }>;
}
```

The export event union mirrors all ten existing typed care event shapes and adds export provenance fields (`familyId`, `babyId`, actor IDs, source, occurred/created/updated time, status and version). It deliberately omits `traceId` and `clientRequestId`. Revision rows contain IDs, actor IDs, action, version edge, typed before/after snapshots and creation time, but no trace ID.

### Operations boundary

```ts
export interface BackupManifestV1 {
  schemaVersion: 1;
  createdAt: string;
  postgresMajor: 16;
  dump: { format: 'postgres-custom'; sha256: string; bytes: number };
  migrationFingerprint: string;
  backupContractVersion: 1;
}

export interface PostgresTools {
  sourceIdentity(): Promise<PostgresClusterIdentity>;
  targetIdentity(): Promise<PostgresClusterIdentity>;
  migrationFingerprint(target: 'source' | 'restore'): Promise<string>;
  dump(destination: NodeJS.WritableStream): Promise<void>;
  listDump(bundle: VerifiedBackupBundle): Promise<DumpCatalogueFacts>;
  assertTargetEmpty(): Promise<void>;
  restore(bundle: VerifiedBackupBundle): Promise<void>;
  verifyRestoredData(): Promise<RestoreInvariantReport>;
  revokeRestoredSessions(): Promise<number>;
}
```

The production adapter executes only fixed PostgreSQL 16 commands. Callers cannot append flags or SQL. Credentials remain in protected environment/service configuration and never enter the argument vector produced by repository code.

### State transitions

```text
backup create: configured parent -> private temp bundle -> dump -> manifest -> self-verify
               -> fsync files/dir -> atomic rename -> valid final bundle

restore verify: verified bundle -> independent empty PG16 target -> restore -> read-only invariants
                -> revoke all sessions -> read-model probe -> usable marker -> teardown
```

Any error before the final transition produces a closed code and no success marker.

## File Map

### Contracts, domain and API

- Create `packages/contracts/src/family-export.ts` — strict export schema/type and filename/content metadata helpers.
- Modify `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts` — export contracts and the closed `export_too_large`, `export_in_progress`, and `export_failed` errors.
- Modify `packages/domain/src/identity.ts`, `packages/domain/src/policy.ts` — `family.export` capability.
- Modify `apps/api/src/config.ts`, `apps/api/src/startup.ts`, `apps/api/src/app.ts` — centralized export limit and route wiring.
- Create `apps/api/src/family/family-export-repository.ts` — deterministic family-scoped set reads on an injected client.
- Create `apps/api/src/family/family-export-service.ts` — one-snapshot assembly, strict validation, stable serialization and bound.
- Create `apps/api/src/family/export-coordinator.ts` — per-process actor concurrency slot with unconditional release.
- Create `apps/api/src/routes/family-export.ts` — origin/auth/capability/headers/audit route.

### Web/PWA

- Modify `apps/web/src/api-client.ts` — binary download response with validated generic filename.
- Create `apps/web/src/family/FamilyDataExport.tsx` — admin-only private export action.
- Modify `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/app.css` — mount control and accessible states.

### Operator package and infrastructure

- Create `packages/operations/package.json`, `tsconfig.json`, `tsup.config.ts`.
- Create `packages/operations/src/contracts.ts` — strict manifest/config/result schemas.
- Create `packages/operations/src/private-files.ts` — realpath/type/mode/fsync/atomic bundle primitives.
- Create `packages/operations/src/postgres-tools.ts` — narrow fixed subprocess abstraction and closed errors.
- Create `packages/operations/src/backup.ts` — create and verify bundle workflows.
- Create `packages/operations/src/restore.ts` — source/target/empty checks, restore, invariants and session sanitation.
- Create `packages/operations/src/cli.ts`, `packages/operations/src/index.ts` — `backup:create`, `backup:verify`, `backup:restore`, `backup:restore-verify`.
- Create `infra/backup/compose.operations.yaml` — isolated PG16 restore target and restored API probe.
- Create `infra/backup/README.md` — operator procedure and explicit safety boundary.
- Modify `apps/api/tsup.config.ts` — add the restored read-model probe build entry; PostgreSQL client tools remain inside the PostgreSQL 16 services.
- Create `apps/api/src/operations/verify-restored-database.ts` — fixed invariant/session/read-model verification command.
- Modify `package.json`, `pnpm-lock.yaml` — workspace commands and operations dependencies.

### Tests and delivery

- Create `packages/contracts/test/family-export.test.ts`.
- Modify `packages/domain/test/policy.test.ts` and `apps/api/test/config.test.ts`.
- Create `apps/api/test/family-export-service.test.ts`.
- Create `apps/api/test/family-export.integration.test.ts`.
- Create `apps/web/test/family-data-export.test.tsx`.
- Create `packages/operations/test/private-files.test.ts`.
- Create `packages/operations/test/backup.test.ts`.
- Create `packages/operations/test/restore.test.ts`.
- Create `packages/operations/test/restore.integration.test.ts`.
- Create `apps/api/test/restored-database-verifier.integration.test.ts`.
- Create `scripts/m4-birth-ready-operations.mjs`.
- Create `apps/api/test/m4-compose-smoke-contract.test.ts`.
- Modify `.github/workflows/ci.yml`, `compose.yaml`, `scripts/collect-diagnostics.mjs` tests only if a new trusted marker is required; never feed backup/export output to diagnostics.
- Modify `README.md`, `docs/PLAN.md`, `summary.md`, `.agent/current-milestone.json` when actual implementation state changes.

---

### Task 1: Export Contracts, Capability And Central Bounds

**Status:** Complete at `5d204bd` (`feat: define M4 export safety contracts`); independent task review approved with no findings.

**Files:**

- Create: `packages/contracts/src/family-export.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts`
- Modify: `packages/domain/src/identity.ts`, `packages/domain/src/policy.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/startup.ts`, `apps/api/src/app.ts`
- Test: `packages/contracts/test/family-export.test.ts`, `packages/domain/test/policy.test.ts`, `apps/api/test/config.test.ts`, `apps/api/test/startup.test.ts`

**Interfaces produced:**

```ts
export const FAMILY_EXPORT_SCHEMA_VERSION = 1;
export const DEFAULT_FAMILY_EXPORT_MAX_BYTES = 33_554_432;
export const FamilyExportSchemaV1: z.ZodType<FamilyExportV1>;
export function familyExportFilename(generatedAt: Date): string;

type Capability = ExistingCapability | 'family.export';
type ApiErrorCode = ExistingApiErrorCode
  | 'export_too_large'
  | 'export_in_progress'
  | 'export_failed';
```

**Steps:**

- [x] Add contract RED cases for one valid all-event export, exact unknown-field rejection at every top-level collection, invalid revision version edges, invalid actor/source/status/time, all three closed export error codes, and deliberate attempts to include `passwordHash`, `loginName`, `tokenHash`, `traceId`, `clientRequestId`, `databaseUrl`, evidence/media/model fields.
- [x] Add deterministic filename RED cases at UTC boundary and assert the result matches `^baby-care-export-\d{8}T\d{6}Z\.json$` and contains no supplied name/UUID.
- [x] Add domain RED cases proving Dad/Mom (`family_admin`) can `family.export` and caregiver/Nanny cannot.
- [x] Add config RED cases proving the default is exactly 32 MiB, a positive bounded integer override is accepted, and zero/negative/non-number/unsafe-large values fail startup. Use the key `FAMILY_EXPORT_MAX_BYTES` and cap configuration at 128 MiB.
- [x] Run and record RED:

  ```bash
  pnpm --filter @baby-care/contracts test -- family-export.test.ts
  pnpm --filter @baby-care/domain test -- policy.test.ts
  pnpm --filter @baby-care/api test -- config.test.ts startup.test.ts
  ```

- [x] Implement strict schemas. Reuse existing care payload schemas; if an existing payload schema is private to `care/query.ts`, export that schema rather than copying a divergent shape.
- [x] Encode explicit deterministic sort requirements in exported helper comparators: members by relationship then membership ID; events by occurred time, created time, ID; revisions by event ID, from version, ID; checkpoints by occurred time, created time, ID; reminder rules by actor membership, local time, weekday mask, ID.
- [x] Add `family.export` without changing existing caregiver capabilities. Wire `FAMILY_EXPORT_MAX_BYTES` through `startServer` to `buildApp`; do not yet register a route.
- [x] Run GREEN and workspace type checks:

  ```bash
  pnpm --filter @baby-care/contracts test -- family-export.test.ts
  pnpm --filter @baby-care/domain test -- policy.test.ts
  pnpm --filter @baby-care/api test -- config.test.ts startup.test.ts
  pnpm --filter @baby-care/contracts typecheck
  pnpm --filter @baby-care/domain typecheck
  pnpm --filter @baby-care/api typecheck
  git diff --check
  ```

- [x] Review that the DTO has no credential/session/trace/client-request/diagnostic/media path and that all ten care kinds remain discriminated and typed.
- [x] Commit locally:

  ```bash
  git add packages/contracts packages/domain apps/api/src/config.ts apps/api/src/startup.ts apps/api/src/app.ts apps/api/test/config.test.ts apps/api/test/startup.test.ts
  git commit -m "feat: define M4 export safety contracts"
  ```

**Completion:** Contracts are strict/versioned, authorization is explicit, and one centralized startup-validated byte limit exists. No export route or operator command exists yet.

---

### Task 2: Deterministic Single-Snapshot Family Export Service

**Files:**

- Create: `apps/api/src/family/family-export-repository.ts`
- Create: `apps/api/src/family/family-export-service.ts`
- Test: `apps/api/test/family-export-service.test.ts`
- Test: `apps/api/test/family-export.integration.test.ts`

**Interfaces produced:**

```ts
export interface FamilyExportRepository {
  readFamilyExport(client: pg.PoolClient, familyId: string): Promise<FamilyExportRows>;
}

export class FamilyExportTooLargeError extends Error {
  readonly code = 'export_too_large';
}

export function createFamilyExportService(
  database: DatabaseContext,
  repository: FamilyExportRepository,
  maxBytes: number,
): FamilyExportService;
```

**Steps:**

- [ ] Write service RED tests with a recording fake client: exact `begin isolation level repeatable read read only`, every repository read receives that client, `commit` after successful validation/serialization, `rollback` on query/schema/serialization/size failures, and one `release` in all paths. Make `database.pool.query` throw to prove no pool escape.
- [ ] Add RED cases for UTF-8 byte length (not JavaScript character count), exact-bound acceptance, one-byte-over rejection, no truncated buffer, stable serialization across shuffled repository rows, and `generatedAt` supplied once by the caller.
- [ ] Add PostgreSQL RED fixtures covering Dad/Mom/Nanny membership states, all ten care kinds, mixed feeding components, bottle capacity, active and voided rows, notes, revision edit/void edges, handoffs, reminder ownership, and machine provenance rows. Assert excluded columns never appear recursively.
- [ ] Add a bounded query-count assertion. The repository must use a fixed set of set-oriented queries independent of event count; expected ceiling is 10 application queries inside the snapshot, excluding `BEGIN`/`COMMIT`.
- [ ] Add a concurrency RED test: pause after the family/event envelope read, commit an edit from a second connection, resume export, and assert the document is wholly pre-edit. A `READ COMMITTED` mutation of the transaction must fail this test.
- [ ] Run RED:

  ```bash
  pnpm --filter @baby-care/api test -- family-export-service.test.ts family-export.integration.test.ts
  ```

  If `TEST_DATABASE_URL` is absent, the unit RED must execute and the PostgreSQL cases must remain enabled/skipped only by the repository's established DB-test harness.

- [ ] Implement repository reads using the injected `PoolClient` only. Fetch envelopes and typed child rows in batches; never perform one query per event. Join actor display identity without exporting login names.
- [ ] Assemble exactly one active family and baby. Treat missing/multiple authoritative rows, orphan typed detail, mismatched event/payload kind, invalid revision edge, or unknown database enum as a closed validation error rather than omitting data.
- [ ] Sort every array with the contract comparators, parse through `FamilyExportSchemaV1`, serialize once with `JSON.stringify`, convert to `Buffer`, enforce `maxBytes`, then commit.
- [ ] Run GREEN and regression:

  ```bash
  pnpm --filter @baby-care/api test -- family-export-service.test.ts family-export.integration.test.ts care-workspace-system.integration.test.ts
  pnpm --filter @baby-care/api typecheck
  pnpm lint
  git diff --check
  ```

- [ ] Review transaction boundaries, query count, typed coverage, excluded fields and deterministic ordering. Do not add an audit write to the read-only transaction.
- [ ] Commit locally:

  ```bash
  git add apps/api/src/family apps/api/test/family-export-service.test.ts apps/api/test/family-export.integration.test.ts
  git commit -m "feat: build consistent family export snapshots"
  ```

**Completion:** A family-scoped, bounded, stable export buffer can be produced entirely from one read-only snapshot. It is not exposed over HTTP yet.

---

### Task 3: Secure Export Route, Audit And Concurrency Gate

**Files:**

- Create: `apps/api/src/family/export-coordinator.ts`
- Create: `apps/api/src/routes/family-export.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/family-export-route.test.ts`
- Extend: `apps/api/test/family-export.integration.test.ts`

**Interfaces produced:**

```ts
export interface ExportCoordinator {
  run<T>(actorUserId: string, operation: () => Promise<T>): Promise<T>;
}

POST /api/family/export
200 application/json + attachment headers
413 { code: 'export_too_large', ... }
409 { code: 'export_in_progress', ... }
500 { code: 'export_failed', ... }
401/403 existing stable auth/origin/capability shapes
```

**Steps:**

- [ ] Add route RED tests for missing/invalid cookie, wrong origin, Nanny, Dad, Mom, and a forged body containing foreign family/baby IDs. The route accepts no request body and derives scope from the authenticated session.
- [ ] Add RED header tests for `application/json`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a generic UTC `Content-Disposition` filename. Assert headers are absent from an injected pre-serialization service failure.
- [ ] Add RED coordinator tests: two simultaneous exports by the same actor produce one running operation and one `409 export_in_progress`; different actors may run concurrently; success, throw, abort/disconnect simulation, and audit failure all release the actor slot.
- [ ] Add audit RED tests proving exactly one successful `family.export` event contains only family/actor/membership/action/target/source/trace/time, with `metadata_json is null`; denial, overflow and failed response preparation create no success audit.
- [ ] Resolve the route's atomicity deliberately: produce/validate the buffer first, then write the allow-listed audit in its own short transaction, then set attachment headers and send. If audit fails, send a closed API failure and never emit the export body.
- [ ] Run RED:

  ```bash
  pnpm --filter @baby-care/api test -- family-export-route.test.ts family-export.integration.test.ts
  ```

- [ ] Implement origin guard, session authentication, `can(permissionLevel, 'family.export')`, actor slot, service call, audit transaction and headers. Use status 413 for `export_too_large`, 409 for `export_in_progress`, and a generic 500 `export_failed` for query/schema/serialization/audit failures; do not expose configured limits, computed bytes, database details or raw errors.
- [ ] Register the service/coordinator/route in `buildApp` with `familyExportMaxBytes` supplied from startup. Preserve existing health-only and setup-only test construction.
- [ ] Run GREEN and full API regression:

  ```bash
  pnpm --filter @baby-care/api test -- family-export-route.test.ts family-export.integration.test.ts
  pnpm --filter @baby-care/api test
  pnpm --filter @baby-care/api typecheck
  pnpm lint
  git diff --check
  ```

- [ ] Review for cross-family lookup, error-shape disclosure, slot leaks, payload/audit leakage, header timing and Fastify buffer handling.
- [ ] Commit locally:

  ```bash
  git add apps/api/src apps/api/test/family-export-route.test.ts apps/api/test/family-export.integration.test.ts
  git commit -m "feat: expose audited family admin export"
  ```

**Completion:** Dad/Mom can request one private attachment; Nanny and unauthenticated callers cannot; successful requests are minimally audited and failures cannot look like complete downloads.

---

### Task 4: Family-Admin Web Download Surface

**Files:**

- Modify: `apps/web/src/api-client.ts`
- Create: `apps/web/src/family/FamilyDataExport.tsx`
- Modify: `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/app.css`
- Test: `apps/web/test/family-data-export.test.tsx`
- Modify fixtures as required: `apps/web/test/App.test.tsx` and care workspace Web tests

**Interfaces produced:**

```ts
export interface FamilyExportDownload {
  blob: Blob;
  filename: string;
}

BabyCareApi.exportFamilyData(): Promise<FamilyExportDownload>;
```

**Steps:**

- [ ] Add Web RED tests for admin visibility, Nanny absence, private-data warning, pending disabled state, one request under double click, successful generic filename download, `URL.createObjectURL`/anchor click/`URL.revokeObjectURL`, and no JSON preview/render.
- [ ] Add RED failure cases: API error keeps the page and warning visible, re-enables retry, revokes any already-created URL, and shows concise text without response details. A forged direct component call under a caregiver session must still receive API denial in the API integration suite.
- [ ] Add response parsing RED cases: require `application/json`, accept only a generic filename matching the contract regex, and substitute a locally generated generic filename if `Content-Disposition` is missing/malformed/private-looking.
- [ ] Run RED:

  ```bash
  pnpm --filter @baby-care/web test -- family-data-export.test.tsx App.test.tsx
  ```

- [ ] Implement `exportFamilyData` as a dedicated binary request path rather than routing through the JSON `request<T>` helper. Always send credentials and the current origin automatically through fetch; do not accept ownership/body parameters.
- [ ] Implement `FamilyDataExport` under the existing Dad/Mom family-admin section. Use a normal button, status text with `aria-live="polite"`, no audio, and existing day/night tokens. Revoke the object URL in `finally` after click scheduling.
- [ ] Run GREEN, Web regression, typecheck and build:

  ```bash
  pnpm --filter @baby-care/web test -- family-data-export.test.tsx App.test.tsx care-day-night-reminders.test.tsx
  pnpm --filter @baby-care/web test
  pnpm --filter @baby-care/web typecheck
  pnpm --filter @baby-care/web build
  pnpm lint
  git diff --check
  ```

- [ ] Review keyboard access, 44px target, narrow layout, night contrast, URL cleanup and absence from Nanny DOM.
- [ ] Commit locally:

  ```bash
  git add apps/web/src apps/web/test
  git commit -m "feat: add private family export download"
  ```

**Completion:** The browser offers a bounded, admin-only private download action without previewing or retaining export data in application state.

---

### Task 5: Private Atomic Backup Creation And Verification

**Files:**

- Create: `packages/operations/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/operations/src/contracts.ts`, `private-files.ts`, `postgres-tools.ts`, `backup.ts`, `index.ts`
- Create: `packages/operations/test/private-files.test.ts`, `backup.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interfaces produced:**

```ts
export const BackupManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime({ offset: true }),
  postgresMajor: z.literal(16),
  dump: z.object({
    format: z.literal('postgres-custom'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
  }).strict(),
  migrationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  backupContractVersion: z.literal(1),
}).strict();

createBackup(config, postgresTools): Promise<{ code: 'backup_created' }>;
verifyBackup(config, postgresTools): Promise<{ code: 'backup_verified' }>;
```

**Steps:**

- [ ] Add manifest RED cases for exact schema, unknown key, wrong version/PG major/format, non-hex digest, zero/negative bytes, and forbidden database/family/path/content keys.
- [ ] Add filesystem RED cases using `mkdtemp`: parent must already exist, be a real directory owned by current uid and inaccessible to group/other; reject symlink at each ancestor/bundle/file, FIFO/socket/directory where a regular file is required, pre-existing final bundle, and mode drift.
- [ ] Add bundle-name RED cases requiring `baby-care-backup-YYYYMMDDTHHMMSSZ` with no family/database/path fragment. Add atomicity RED cases with injected failures at temp creation, dump stream, file fsync, manifest write, digest self-check, directory fsync and rename. Assert no final-looking bundle and cleanup of owned temp state only.
- [ ] Add backup RED cases proving the PostgreSQL adapter receives only fixed PG16 Compose-service actions: custom format, `--no-owner`, `--no-privileges`, no table/schema filters; no credential/URL/operator flag appears in arguments/results/errors. Require catalogue facts for the complete Baby Care schema, including users, sessions, audit, all typed care tables, revisions, handoffs and reminders. Migration fingerprint canonicalizes ordered migration ID/hash/time facts.
- [ ] Add verify RED cases for corrupt/truncated dump, byte mismatch, digest mismatch, manifest mismatch, unsupported version, missing `drizzle.__drizzle_migrations` catalogue facts, oversized/unbounded catalogue output and raw subprocess error redaction. Prove `backup:verify` invokes no database write or restore action.
- [ ] Run RED:

  ```bash
  pnpm --filter @baby-care/operations test -- private-files.test.ts backup.test.ts
  ```

- [ ] Implement the package with Node built-ins (`fs`, `crypto`, `stream`, `child_process`) and Zod. Production code uses `lstat`/`realpath`, `O_NOFOLLOW` where available plus post-open identity checks, temp directory `0700`, files `0600`, same-parent temp creation, file and directory `fsync`, and same-filesystem rename.
- [ ] Stream `pg_dump` directly into `database.dump`; never buffer the dump in memory. Hash/count while streaming, write the strict manifest, then call the same verifier before final rename.
- [ ] Implement `pg_restore --list` with a byte/time bound and reduce it immediately to boolean catalogue facts; never return/print catalogue lines.
- [ ] Run GREEN and package gates:

  ```bash
  pnpm --filter @baby-care/operations test
  pnpm --filter @baby-care/operations typecheck
  pnpm --filter @baby-care/operations build
  pnpm lint
  git diff --check
  ```

- [ ] Review TOCTOU/symlink handling, ownership/modes, fsync ordering, cleanup scope, subprocess bounds and error redaction.
- [ ] Commit locally:

  ```bash
  git add packages/operations package.json pnpm-lock.yaml
  git commit -m "feat: create private atomic backup bundles"
  ```

**Completion:** Generated fixtures can produce and verify an atomic private v1 backup bundle through a narrow fake/real PostgreSQL tool boundary; no restore exists yet.

---

### Task 6: Fail-Closed Restore, Invariants And Session Sanitation

**Files:**

- Create: `packages/operations/src/restore.ts`
- Modify: `packages/operations/src/contracts.ts`, `postgres-tools.ts`, `index.ts`
- Create: `packages/operations/test/restore.test.ts`, `restore.integration.test.ts`
- Create: `apps/api/src/operations/verify-restored-database.ts`
- Modify: `apps/api/tsup.config.ts`
- Create: `apps/api/test/restored-database-verifier.integration.test.ts`

**Interfaces produced:**

```ts
restoreBackup(config, postgresTools): Promise<{
  code: 'restore_verified';
  revokedSessionCount: number;
}>;

interface RestoreInvariantReport {
  migrationsMatch: true;
  singleActiveFamily: true;
  singleActiveBaby: true;
  ownershipValid: true;
  typedDetailsValid: true;
  revisionEdgesValid: true;
  handoffsValid: true;
  remindersValid: true;
  summaryExecutable: true;
  timelineExecutable: true;
}
```

**Steps:**

- [ ] Add unit RED cases enforcing order: verify bundle -> query source/target cluster identity -> require different `system_identifier` -> require PG16 -> require empty target -> restore -> read-only invariants -> transactionally revoke sessions -> existing API read-model probe -> success. Every failed predecessor prevents later calls.
- [ ] Add RED cases for same cluster even with different database name, unknown identity, non-empty public objects, existing Drizzle migration history, wrong PG major, forbidden restore flags, restore failure, invariant failure, sanitation rollback and read-model failure.
- [ ] Add PostgreSQL RED integration using disposable generated databases: valid restore, non-empty target refusal, source remains byte/count/version unchanged after target failure, migration fingerprint equality, foreign-key/orphan checks, typed-detail cardinality, revision `fromVersion -> toVersion`, active/voided coherence, handoff/reminder ownership.
- [ ] Add restored-session RED: seed active/revoked sessions, restore, revoke all non-revoked sessions in one transaction, prove the old raw cookie is rejected, prove restored password hash still permits a fresh Dad login, and prove only `sessions.revoked_at` changes. Care, revision, handoff, reminder, family, baby, user and audit rows remain byte-for-byte/logically unchanged by sanitation.
- [ ] Add API verifier RED cases that construct the existing `createQueryService`, derive one server-owned family/baby actor context from fixed SQL, run summary and a one-item timeline on the target, and emit only a closed success/failure code.
- [ ] Run RED:

  ```bash
  pnpm --filter @baby-care/operations test -- restore.test.ts restore.integration.test.ts
  pnpm --filter @baby-care/api test -- restored-database-verifier.integration.test.ts
  ```

- [ ] Implement target checks with fixed SQL and no caller-provided SQL. `pg_restore` receives only the verified dump plus fixed `--exit-on-error --no-owner --no-privileges`; never expose `--clean`, `--create`, role or schema selection.
- [ ] Run structural invariants in a `REPEATABLE READ READ ONLY` transaction. Perform session revocation in a separate transaction only after structural success. Then run the API read-model probe; a probe failure leaves the restored target explicitly unusable and emits no success marker.
- [ ] Ensure cleanup waits for bounded subprocess/client settlement and never modifies source state. Do not automatically delete a failed operator target; the disposable `restore-verify` wrapper handles teardown later.
- [ ] Run GREEN and focused regression:

  ```bash
  pnpm --filter @baby-care/operations test
  pnpm --filter @baby-care/api test -- restored-database-verifier.integration.test.ts care-workspace-system.integration.test.ts
  pnpm --filter @baby-care/operations typecheck
  pnpm --filter @baby-care/api typecheck
  pnpm lint
  git diff --check
  ```

- [ ] Independently review source/target identity proof, empty-target definition, write set, transaction ordering, session behavior, restored login and failure cleanup.
- [ ] Commit locally:

  ```bash
  git add packages/operations apps/api/src/operations apps/api/test/restored-database-verifier.integration.test.ts apps/api/tsup.config.ts
  git commit -m "feat: verify isolated restores and revoke sessions"
  ```

**Completion:** The library can restore only a verified bundle to an independent empty target, verify fixed invariants, revoke restored sessions and prove API read models without changing the source.

---

### Task 7: Operator CLI And Disposable PostgreSQL 16 Restore Practice

**Files:**

- Create: `packages/operations/src/cli.ts`
- Modify: `packages/operations/tsup.config.ts`, `package.json`
- Create: `infra/backup/compose.operations.yaml`, `infra/backup/README.md`
- Modify: `compose.yaml`
- Create: `packages/operations/test/cli.test.ts`
- Extend: `packages/operations/test/restore.integration.test.ts`

**Commands produced:**

```bash
pnpm backup:create
pnpm backup:verify
pnpm backup:restore
pnpm backup:restore-verify
```

Configuration is environment-only and schema-validated. At minimum it includes the private output parent, bundle selector, fixed Compose project, source service and restore service. There is no CLI flag for database URL, password, SQL, restore options, overwrite, clean, create or output path outside the approved parent.

**Steps:**

- [ ] Add CLI RED cases for missing/unknown configuration, unsafe parent, unknown command/extra positional args, and attempted restore flags. Assert exit codes and stable messages only; capture stdout/stderr and scan for fixture paths, credentials, SQL, subprocess arguments and raw errors.
- [ ] Add `backup:create`/`backup:verify` RED contract tests proving only the final generic status code is printed and no final bundle is overwritten.
- [ ] Add `backup:restore` RED tests proving it requires a separately running configured target and does not create/delete infrastructure.
- [ ] Add `backup:restore-verify` RED tests proving it creates a new disposable PostgreSQL 16 restore service/volume, waits for health, invokes restore, captures only aggregate result, starts the restored API/probe only after verification, and tears down that isolated service/volume in `finally`. On failure the target remains disconnected/unusable for inspection or is discarded by this wrapper. It must refuse a Compose project/service identity not matching the fixed configuration.
- [ ] Define `infra/backup/compose.operations.yaml` with `postgres_restore` on its own volume and no household volume mount. Add a restored API/probe service that starts only after restore; do not auto-migrate the target before the empty-target proof. The normal API must never point at this target.
- [ ] Implement the production adapter on the host: invoke `pg_dump`, `pg_restore` and `psql` only through validated, named PostgreSQL 16 Compose services; stream dump bytes over stdio; keep credentials inside service environment; and suppress/reduce subprocess output. Fail before backup if tool and source/target server major versions are not 16.
- [ ] Implement the CLI as a thin mapping from four exact commands to library calls. Never log config or caught exceptions. Use an allow-listed error-code mapper.
- [ ] Write operator docs with: sensitivity warning; private destination prerequisites; exact create/verify/restore-verify/status cleanup commands; source/target distinction; no in-place restore; no automatic retention/encryption claims; and explicit prohibition on storing bundles/exports in Git or CI artifacts.
- [ ] Run GREEN:

  ```bash
  pnpm --filter @baby-care/operations test -- cli.test.ts restore.integration.test.ts
  pnpm --filter @baby-care/operations build
  pnpm backup:verify --help
  pnpm lint
  pnpm typecheck
  pnpm build
  git diff --check
  ```

  `--help` may show command names and generic configuration key names only; it must not print effective values or paths.

- [ ] If Docker is available, run the disposable generated-data flow once and verify modes with `stat`; otherwise defer the real tool path to Task 8 exact-head Compose CI without weakening tests.
- [ ] Review command injection, argv/environment boundaries, Compose volume identity, teardown scope, docs and absence of destructive flags.
- [ ] Commit locally:

  ```bash
  git add packages/operations infra/backup compose.yaml package.json pnpm-lock.yaml
  git commit -m "feat: add guarded backup restore operator CLI"
  ```

**Completion:** An operator has fixed commands for create, verify, empty-target restore and disposable restore practice, with safe output and no HTTP/operator UI surface.

---

### Task 8: Synthetic Birth Ready Operations Simulation And Privacy Gate

**Files:**

- Create: `scripts/m4-birth-ready-operations.mjs`
- Create: `apps/api/test/m4-compose-smoke-contract.test.ts`
- Modify: `.github/workflows/ci.yml`, `compose.yaml` only as required to invoke the operations overlay
- Modify: `scripts/collect-diagnostics.mjs` tests only if needed; do not add raw evidence ingestion
- Modify: `README.md`, `docs/PLAN.md`, `summary.md`, `.agent/current-milestone.json`

**Fixed markers:**

```text
SMOKE_OK component=m4-family-export
SMOKE_OK component=m4-backup-integrity
SMOKE_OK component=m4-isolated-restore
SMOKE_OK component=m4-birth-ready-operations
```

**Steps:**

- [ ] Write a static smoke-contract RED test before changing the script. It must require all four markers exactly once and in order, all M4 route/backup/restore calls, both admin exports, Nanny denial, old-cookie denial, fresh login, and the stable typed comparison fields. It must reject any log statement containing response bodies, dump/manifest content, credentials, paths or care fixture values.
- [ ] Extend/add production-mode simulation with new synthetic identities and a new empty source volume. Do not reuse a developer or household database. Preserve the existing M1–M3 smoke flow or invoke it first unchanged.
- [ ] Implement exact flow assertions without printing values:
  1. setup one family/baby; Dad and Mom login; create/login Nanny;
  2. record mixed feeding, diaper/stool, sleep/wake, burping, spit-up, bathing, temperature, weight and administered medication across all three actors;
  3. cross family-local midnight and prove rolling 24h;
  4. Dad -> Nanny -> Mom explicit handoffs and fixed briefing;
  5. warning confirmation, stale conflict/reconcile, edit, void undo and revision history;
  6. reminder PUT/GET with unchanged latest checkpoint;
  7. Dad and Mom export parse against schema v1; Nanny receives stable denial;
  8. compute in-memory stable pre-restore digest/count/version facts, discard export buffers;
  9. create and verify private backup in a temporary `0700` directory outside the repository;
  10. restore to isolated PG16, reject old cookie, fresh Dad login, and compare timeline/summary/revision/handoff/actor/status digests.
- [ ] Emit each marker only after its entire preceding gate is complete. Do not emit a partial success marker in catch/finally.
- [ ] Update the PostgreSQL integration job with a second disposable PostgreSQL 16 target and `TEST_RESTORE_DATABASE_URL`, then run both API and operations integration suites. Update Compose CI to install the workspace dependencies, run the existing smoke, build the operations CLI, and run the M4 operations script with the operations overlay. Teardown both source and restore volumes with `if: always()`. Do not upload the backup root or operation logs containing raw tool output.
- [ ] Add/extend privacy tests for the diagnostic collector: raw export/dump/manifest/path-looking text supplied as untrusted evidence is ignored/redacted; only the existing strict trusted metadata schema may survive. Do not add live M4 artifacts to test fixtures.
- [ ] Run focused GREEN:

  ```bash
  pnpm --filter @baby-care/api test -- m4-compose-smoke-contract.test.ts
  pnpm --filter @baby-care/observability test
  node --check scripts/m4-birth-ready-operations.mjs
  git diff --check
  ```

- [ ] Run the full non-Compose gate sequentially to avoid resource-starvation false failures:

  ```bash
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm build
  git diff --check
  ```

- [ ] Run scope and secret scans over tracked changes, excluding generated dependencies/build output. Search for real-looking cookies/tokens/passwords, database URLs, export/dump filenames, absolute backup paths and private care fixture values.
- [ ] If Docker is available, run production Compose and assert every M1/M2/M3 marker plus all four M4 markers exactly once. Otherwise record `docker_cli_unavailable` and leave M4 `awaiting_exact_head_ci`.
- [ ] Update durable state accurately:
  - implementation complete locally, not verified complete until exact-head CI;
  - authoritative M3 head/CI unchanged;
  - M4 plan/spec/branch and local implementation head recorded;
  - human family acceptance remains pending;
  - Guardian/audio and `baby-monitor-local` remain independent and non-blocking.
- [ ] Review the complete M4 diff against every spec section and resolve all Critical/Important findings before commit.
- [ ] Commit locally:

  ```bash
  git add scripts/m4-birth-ready-operations.mjs apps/api/test/m4-compose-smoke-contract.test.ts .github/workflows/ci.yml compose.yaml README.md docs/PLAN.md summary.md .agent/current-milestone.json packages/observability
  git commit -m "test: close M4 birth ready operations loop"
  ```

**Completion:** The entire M4 software loop is implemented and locally verified as far as the environment permits. It is still not software-complete until Task 9 exact-head CI passes.

---

### Task 9: Exact-Head Release Evidence And Human Handoff

**Files:**

- Modify after verified remote run: `README.md`, `docs/PLAN.md`, `summary.md`, `.agent/current-milestone.json`
- No business-code changes unless a reproducible CI defect is found and fixed through a new RED/GREEN slice.

**Remote authorization gate:** Stop before any push/PR mutation unless the user has explicitly authorized it in the executing session.

**Steps:**

- [ ] Confirm clean branch, exact local head, full local gate evidence, no private artifacts and no untracked backup/export files.
- [ ] With explicit authorization only, push `codex/m4-birth-ready-operations` and create/update an M4 Draft PR targeting `codex/m3-care-workspace-implementation` (not `main`).
- [ ] Wait for the exact-head GitHub Actions run. Require static, unit, PostgreSQL integration, build and production Compose 5/5 PASS.
- [ ] Inspect compact diagnostics first on failure. Apply `superpowers:systematic-debugging`; reproduce, add a failing test, make the minimum fix, rerun all affected gates, commit, and only push again if authorization remains valid.
- [ ] Verify the Compose job emitted each M4 marker exactly once and did not upload export/backup artifacts. Record exact head, CI run ID and Compose job ID.
- [ ] Update durable state from `implementation_complete_awaiting_ci` to `verified_complete` only after the exact-head run. The documentation closure commit itself requires one final exact-head CI run; record the prior verified implementation run without creating an infinite self-reference requirement.
- [ ] Commit the state closure locally, then push it only with explicit authorization. Confirm the closure-head CI 5/5 PASS and record that run in the Draft PR rather than rewriting Git state again.
- [ ] Prepare one-step-at-a-time human acceptance instructions, but do not execute or claim them:
  1. Dad/Mom verifies the private export interaction;
  2. chooses an owner-private destination outside Git;
  3. creates/verifies a backup;
  4. runs isolated restore-verify;
  5. confirms Nanny cannot see export;
  6. completes a supervised normal-care walkthrough.
- [ ] Do not restore into the live family database, inspect private export contents, merge PRs, modify `main`, tag a release, or start Guardian/voice work.

**Completion:** One exact Git head has all five CI jobs and four M4 markers verified, durable state is accurate, and the remaining human acceptance gate is explicit. M4 software completion does not imply household acceptance or a live restore.

---

## Cross-Task Verification Matrix

| Requirement | Primary task | Required evidence |
|---|---:|---|
| Strict complete schema v1, excluded secrets/internal fields | 1–2 | contract + service + PG integration |
| Dad/Mom allowed; Nanny/unauth/cross-family denied | 1, 3, 8 | domain + route + Compose |
| One RR read-only snapshot/no pool escape/concurrent edit consistency | 2 | unit executor proof + real PG concurrency |
| 32 MiB pre-header bound/no truncation | 1–3 | config + UTF-8 boundary + route failure |
| Minimal successful audit | 3 | DB audit assertions |
| Web admin-only/no preview/double-click/URL cleanup | 4 | Testing Library |
| Private atomic custom-format backup | 5 | fault-injected FS + command adapter + Compose |
| Manifest/digest/catalogue/migration verification | 5 | unit corruption matrix + PG16 tool run |
| Independent empty target/no destructive flags | 6–7 | unit order + cluster identity + real restore |
| Structural/semantic restore verification | 6, 8 | PG integration + API read models + digest compare |
| Revoked old sessions/fresh login | 6, 8 | API/DB integration + Compose |
| Source unchanged on restore failure | 6 | before/after source digest/count assertions |
| Four exact M4 markers/privacy-safe diagnostics | 8–9 | static contract + exact-head Compose/CI |
| Human operational acceptance separated | 9 | explicit pending checklist, no automated claim |

## Plan Self-Review Checklist

Before accepting this plan as executable:

- [x] Every included section of the approved M4 spec maps to at least one task and test in the matrix.
- [x] Every excluded item remains outside the file map and task steps.
- [x] Every new public interface has one owning task and typed consumers.
- [x] PostgreSQL-dependent tests remain enabled when local DB/Docker is unavailable.
- [x] No task accepts credentials, database URLs, paths, SQL or destructive flags through ordinary CLI arguments.
- [x] No task writes export/dump data into repository fixtures, CI artifacts, diagnostics or logs.
- [x] Search plan text for placeholders and unresolved choices (exclude this command itself):

  ```bash
  rg -n "TODO|TBD|FIXME|later decide|choose one" docs/superpowers/plans/2026-08-17-m4-birth-ready-operations-data-safety.md | rg -v "rg -n"
  ```

- [x] Validate paths against the current repository and run `git diff --check`.
