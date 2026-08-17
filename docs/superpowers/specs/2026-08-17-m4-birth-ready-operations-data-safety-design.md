# M4 Birth Ready Operations And Data Safety Design

Status: approved in conversation on 2026-08-17; written for final review

Milestone: M4 — Birth Ready Operations and Data Safety

Branch: `codex/m4-birth-ready-operations`

Baseline: `codex/m3-care-workspace-implementation @ 52b042a66122464af338a2b4931315d92dff0965`

## 1. Goal

Close the minimum operational and data-safety loop required before the family relies on
Baby Care for real newborn care. M4 must let Dad or Mom export the family's care data,
let an operator create and verify a private PostgreSQL backup, prove recovery into an
empty isolated database, and run a synthetic Birth Ready family simulation across
Dad/Mom/Nanny workflows.

M4 preserves every verified M1–M3 care semantic. It does not reopen care recording,
handoff, timeline, revision, reminder, or display-mode design.

## 2. Why This Milestone Is Next

Three approaches were considered:

1. **Operations and data safety now — selected.** Backup, restore, family export, and
   an operational simulation close existing P0 commitments with no Guardian dependency.
2. **Full offline synchronization now — deferred.** M2/M3 already preserve drafts and
   idempotency. A durable offline queue adds conflict and security complexity that family
   simulation has not yet shown to be necessary.
3. **Guardian/voice integration now — deferred to a separate milestone.** The long-term
   voice-first direction is approved, but the adapter, active-caregiver lease, and
   candidate-confirmation contract require their own design. Guardian remains unable to
   write Baby Care storage directly.

## 3. Success Criteria

M4 is complete only when all of the following are proven on one exact Git head:

- Dad and Mom can download one complete, versioned family-data export.
- Nanny and unauthenticated callers receive the existing stable non-disclosing denial.
- The export is derived from one repeatable-read snapshot and never silently truncates.
- Backup creation produces an atomic, private, digest-verified PostgreSQL bundle.
- Restore refuses a non-empty destination and never modifies the source database.
- A backup restores into an isolated empty PostgreSQL 16 database and passes structural
  and semantic verification.
- A production-mode synthetic simulation completes setup, three-caregiver recording,
  takeover, rolling-24-hour review, correction, undo, backup, isolated restore, and
  post-restore verification.
- Static, unit, PostgreSQL integration, production build, and production Compose gates
  pass; compact diagnostics contain no care payloads, credentials, paths, dump content,
  or export bodies.

These gates prove software and synthetic operations. They do not prove that a family
has reviewed the export, practiced recovery, or accepted the product for real care.

## 4. Scope

### 4.1 Included

- Versioned private family-data export for authenticated family administrators.
- Export Web control for Dad/Mom with bounded progress, success, and failure states.
- PostgreSQL custom-format backup creation, manifest generation, integrity verification,
  and empty-target restore.
- A non-destructive restore-verification command using an isolated temporary database.
- A synthetic Birth Ready operational simulation and fixed release markers.
- Operator documentation for creating, checking, restoring, and protecting backups.
- Audit records for successful export requests, without recording private payloads.

### 4.2 Excluded

- Guardian ingestion, camera/audio integration, wake word, ASR, TTS, JoyAI, or Qwen.
- Full offline queueing or multi-device synchronization.
- Cloud deployment, cloud backup, remote object storage, email, or third-party sharing.
- Automatic backup scheduling, automatic retention deletion, or silent overwrite of an
  existing database. Commands must be schedule-ready, but scheduler selection is later.
- Encryption-key lifecycle or an encrypted off-site archive. M4 relies on private local
  storage and documents that copied exports/backups remain sensitive. It must not invent
  or escrow a household encryption key.
- Public/content export, anonymization for publishing, medical summaries, diagnosis, or
  medication recommendations.
- `main` integration, release tagging, or production data migration without separate
  approval.

## 5. Authority And Access

Baby Care remains the only authority for family care records.

- `family_admin` (Dad/Mom) may request a private family export.
- `caregiver` (Nanny) may not export family data, run backup/restore, or view operator
  status. The API denial must not reveal whether an export exists.
- Backup and restore are operator-only repository commands. They are not HTTP routes and
  never accept a browser session as authority.
- Restore requires an explicitly configured target database and verifies it is empty.
  There is no in-place production restore path in M4.
- Guardian, AI, device, and import sources remain visible as provenance when such records
  exist, but M4 creates no new machine-write interface.

## 6. Private Family Export

### 6.1 Route And Response

Add an authenticated origin-guarded route:

```text
POST /api/family/export
```

The route returns `application/json` with:

- `Cache-Control: no-store`;
- `Content-Disposition: attachment` using a generic UTC filename such as
  `baby-care-export-20260817T120000Z.json`;
- `X-Content-Type-Options: nosniff`.

The filename must not contain a family name, baby name, login name, address, or UUID.
The server constructs and validates the entire bounded payload before sending response
headers so a database or serialization failure cannot look like a complete download.

### 6.2 Export Schema

The top-level contract is strict and versioned:

```text
schemaVersion: 1
generatedAt: ISO timestamp
family: family identity and timezone
baby: baby identity and birth date
members: display identity, relationship, permission and status
careEvents: active and voided typed care facts
careRevisions: append-only edit/void history
handoffCheckpoints: attributable takeover facts
handoffReminderRules: caregiver-owned reminder configuration
```

Rows use deterministic ordering and preserve stable IDs, actor attribution, source,
effective time, created/updated time, status, version, typed payloads, and revision
causality. Bottle capacity remains metadata and never contributes to intake. Direct
breastfeeding remains minutes only. Medication remains an administered fact only.

The export excludes:

- password hashes, login credentials, setup tokens, sessions, cookies, and token hashes;
- trace IDs, client request IDs, internal diagnostic/audit metadata, database connection
  details, and local paths;
- Guardian evidence pointers, camera/audio/video media, raw model output, or binary data.

The export is private family data, not a sanitized publishing artifact. Notes,
medication facts, temperature, weight, and care details are included because omission
would make the family export incomplete. The Web must warn Dad/Mom to store it privately.

### 6.3 Snapshot And Bounds

All export queries run through one `REPEATABLE READ READ ONLY` transaction and one
PostgreSQL client. No query may escape to the pool during that snapshot.

The serialized export has a centralized maximum byte size. The initial default is
32 MiB. Exceeding it returns a stable `export_too_large` response before any body is
sent; it never truncates or pages a supposedly complete export. The operator backup
path remains the lossless recovery mechanism when the convenience export exceeds this
bound.

Only one export may execute per authenticated actor at a time in one API process.
Disconnect, timeout, database, validation, or audit failure must release that slot.

### 6.4 Audit And Web Behavior

The API writes one allow-listed audit fact for a successful export request: actor,
family target, action `family.export`, source, trace, and occurrence time. It records no
export content, byte count, filenames, notes, care values, or database details.

The Web shows the export action only to `family_admin`. It does not render or preview
the JSON. It downloads the returned blob, revokes the temporary object URL, retains the
current page on failure, and displays a concise private-data warning. Repeated clicks
while a request is pending are disabled.

## 7. Backup Bundle

### 7.1 Bundle Format

An operator command creates a directory bundle atomically:

```text
baby-care-backup-<UTC timestamp>/
  database.dump
  manifest.json
```

`database.dump` is PostgreSQL custom format produced by PostgreSQL 16 `pg_dump` with
owner and privilege restoration disabled. The restore command also fixes
`--no-owner --no-privileges`; repository tooling never creates or alters database roles.
`manifest.json` is strict schema version 1 and contains only:

- UTC creation time;
- PostgreSQL major version;
- dump format and SHA-256;
- dump byte length;
- migration-history fingerprint;
- application backup-contract version.

It contains no database URL, password, host, source path, family/baby identity, table
contents, row values, or care summaries.

The output parent is supplied through approved operator configuration and must already
exist as an owner-private real directory. Creation and verification reject symbolic-link
ancestors and non-regular bundle files. A same-filesystem temporary directory is created
with mode `0700`; files use `0600`; the final bundle appears only after dump completion,
manifest validation, digest verification, file/directory `fsync`, and atomic rename.
If any durability operation is unavailable or fails, the run fails closed. A failed run
leaves no valid-looking final bundle.

Database credentials are consumed from the existing protected environment/runtime
boundary. They must not be copied into command arguments, output, manifests, diagnostics,
or process titles constructed by repository code.

The dump is a complete private recovery artifact. It contains password hashes, session
token hashes, audit rows, and care data even though it contains no raw password or raw
session token. Treating it as less sensitive than the live database is forbidden.

### 7.2 Verification

`backup:verify` performs no database write. It verifies:

- exact manifest schema and supported contract version;
- private file types and no symlink traversal;
- PostgreSQL major/format compatibility;
- exact byte length and SHA-256;
- a bounded `pg_restore --list` structural check;
- required migration history is present in the dump catalogue.

Only closed status codes and aggregate outcomes are printed. The command never prints
paths, database URLs, dump catalogue entries, row values, or raw subprocess errors.

## 8. Restore Safety

M4 has no in-place restore.

`backup:restore` requires a separately configured target database. Before calling
`pg_restore`, it proves:

- the bundle passes `backup:verify`;
- the target resolves independently from the configured source database;
- PostgreSQL major version is supported;
- the target contains no user schema objects or Baby Care migration history.

If any proof is missing, restore fails closed. `--clean`, `--create`, arbitrary SQL,
and overwrite flags are not exposed.

After restore, verification runs read-only invariants:

- migrations match the manifest fingerprint;
- exactly one active family and one active baby remain;
- family/baby/membership ownership foreign keys are valid;
- event, typed-detail, revision, handoff, and reminder relations are internally
  consistent;
- active/voided versions and revision edges are coherent;
- server-derived summary and timeline queries can execute.

Before a restored target can be marked usable, a dedicated transaction revokes every
restored Web session. This prevents an old backup from resurrecting a session that was
revoked after the backup was taken. Existing cookies must fail after restore; Dad/Mom
can authenticate again using restored password hashes. No other care or audit history is
rewritten during this sanitation step.

Verification emits aggregate pass/fail markers only. On failure the isolated target is
left marked unusable for inspection or discarded by the simulation harness; it is never
promoted automatically.

`backup:restore-verify` creates an isolated temporary PostgreSQL 16 target, restores,
checks, and tears it down. It is the CI and routine operator practice command. The
source database remains live and read-only throughout backup creation.

## 9. Birth Ready Operational Simulation

The simulation runs only against a disposable production-mode Compose project with a
new database volume and synthetic identities/data. It must never attach to a configured
household database.

The fixed flow covers:

1. Empty-database setup for one synthetic family and baby.
2. Dad and Mom login as family administrators; Nanny creation and caregiver login.
3. Dad/Mom/Nanny care entries covering mixed feeding, diaper/stool, sleep/wake,
   burping, spit-up, bathing, temperature, weight, and medication administered.
4. Rolling-24-hour behavior across a family-local midnight boundary.
5. Explicit handoffs Dad -> Nanny -> Mom and fixed briefing review.
6. One warning confirmation, one version conflict/reconciliation, one edit, and one
   void-based undo with revision history.
7. Reminder configuration proving it creates no checkpoint fact.
8. Dad and Mom export success; Nanny export denial.
9. Private backup creation and verification.
10. Restore into an isolated empty database, prove the pre-restore cookie is rejected,
    then log Dad in again and compare typed timeline, summaries, revisions, handoffs,
    actor attribution, and active/voided state.

Comparison uses stable IDs, typed facts, versions, counts, and deterministic digests.
It does not print care values or embed export/backup contents in CI logs.

The release flow emits these exact markers once:

```text
SMOKE_OK component=m4-family-export
SMOKE_OK component=m4-backup-integrity
SMOKE_OK component=m4-isolated-restore
SMOKE_OK component=m4-birth-ready-operations
```

## 10. Failure Model And Diagnostics

- Export authorization failure uses the existing non-disclosing auth/forbidden model.
- Export query, serialization, limit, and audit failures return closed API errors; no
  partial success marker is emitted.
- Backup subprocess, storage, permission, digest, and manifest failures remove temporary
  state and emit only a stable failure category.
- Restore verification failure never promotes, swaps, or overwrites a database.
- CI diagnostic collection uses trusted allow-listed metadata only. It never reads raw
  exports, dumps, manifests containing paths, SQL output, or care payloads.
- Secrets, connection strings, subprocess commands, absolute paths, filenames, table
  values, and raw exceptions are excluded from normal output and compact diagnostics.

## 11. Testing And Release Gates

### Contract and domain tests

- strict export schema and unknown-field rejection;
- no credential/session/trace/client-request fields in export DTOs;
- deterministic ordering and stable serialization;
- export-size boundary without truncation;
- generic filename and no-store/nosniff headers.

### PostgreSQL integration

- Dad/Mom success, Nanny/cross-family/unauthenticated denial;
- one repeatable-read snapshot under a concurrent committed edit;
- no pool query escape and bounded query count;
- active/voided events, typed details, revision causality, handoffs, reminders, and
  actor/source attribution exported correctly;
- audit payload stays allow-listed.

### Backup and restore tests

- atomic creation and private permissions;
- corrupted dump, digest, manifest, version, symlink, and partial bundle rejection;
- non-empty target refusal and source/target identity rejection;
- migration and relational invariant verification;
- restored-session revocation and successful fresh login;
- source remains unchanged when restore or verification fails.

Tests use generated fixtures, disposable PostgreSQL databases, and temporary private
directories. No real family export or backup enters Git or CI artifacts.

### Web tests

- admin-only action visibility;
- Nanny cannot trigger export even with a forged UI call;
- pending double-click protection, failure recovery, generic filename, blob URL cleanup,
  and private-data warning;
- day/night accessibility remains intact.

### Final gate

Run lint, all workspace typechecks/tests, PostgreSQL integration, API/Web production
builds, production Compose operational simulation, backup/restore privacy scan, and
`git diff --check`. Require a fresh exact-head GitHub Actions run before M4 can be
called software-complete.

## 12. Human Acceptance Boundary

After the exact-head software gate, one Dad/Mom family administrator must:

- download a private export and confirm the browser interaction is understandable;
- choose a private local backup destination outside Git;
- create and verify one backup;
- practice the isolated restore-verification command;
- confirm that Nanny cannot see the export action;
- complete a supervised normal-care operational walkthrough without using real medical
  decisions as a test.

This human gate may identify usability changes. It does not permit destructive restore
into a live family database, public sharing of exports, or unattended-care claims.

## 13. Delivery Boundary

Implementation proceeds on `codex/m4-birth-ready-operations` from the verified M3
head. Use RED -> GREEN, bounded task commits, task review, exact-head CI, and an M4
Draft PR. Do not modify or merge `main`, merge M3, push credentials/private data, tag a
release, or perform a real-family restore without separate explicit approval.
