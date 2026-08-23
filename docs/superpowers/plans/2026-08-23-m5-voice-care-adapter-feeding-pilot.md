# M5 Voice Care Adapter And Feeding Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Baby Care half of a private, fail-closed Voice Care feeding pilot in which one paired Baby Local device submits signed typed intents, one authenticated active-caregiver lease supplies the actor, and only an explicitly confirmed proposal becomes one existing Baby Care feeding event.

**Architecture:** Add a dedicated Voice Care boundary in front of the existing care services: strict shared contracts and canonical signing bytes, paired-device authentication, a time-limited caregiver lease, a durable pending feeding session, and transactional promotion through the existing feeding writer. Keep browser authentication, device authentication and speaker observations separate; preserve manual care, M4 export/backup/restore and all independent Baby Local/Guardian services when Voice Care is unavailable.

**Tech Stack:** Node 24+, TypeScript 5.9+, pnpm 10.17.1, Zod, Fastify, PostgreSQL 16, Drizzle ORM/Kit, Ed25519 through `node:crypto`, React/Vite PWA, Vitest, Testing Library, Docker Compose and GitHub Actions public runners.

**Spec:** `docs/superpowers/specs/2026-08-23-m5-voice-care-adapter-feeding-pilot-design.md`

## Global Constraints

- Product baseline is `codex/m3-care-workspace-implementation @ cebd5d35c6095b08982216ccc706f0226e710dbc`; approved design commit is `936129e88d88f7810cfa18d730e1c3f3fe85cd73`.
- Execute on a new `codex/m5-voice-care-adapter-implementation` branch created from the reviewed plan head. Do not modify, merge or retarget `main`.
- Baby Care remains authoritative for family, baby, membership, permission, care facts, revisions, undo, export and restore. Baby Local remains authoritative for microphone ingest, VAD, wake, ASR, local private key and local phrase rendering.
- Speaker state never selects Dad, Mom or Nanny. Only an unexpired, unrevoked Baby Care lease issued from an authenticated `care.write` browser session supplies the Voice Care actor.
- Pairing challenge expiry is exactly five minutes. Active-caregiver lease maximum age is exactly eight hours with no silent renewal. Live intent clock tolerance is exactly two minutes. An unfinished pending session becomes `needs_review` after exactly six hours.
- Device delivery allows exactly one in-flight request per device, at most 30 accepted attempts per rolling minute per device, a 30-second database/route deadline and no caller-configurable override for those bounds.
- One active lease is allowed per family/device. A replacement lease revokes the previous lease and writes the existing handoff checkpoint atomically.
- The only v1 device capability is `voice_care.intent.submit`. Device credentials never authorize browser, family-admin, export, backup or restore routes.
- Accepted device intent kinds are exactly `feeding_start`, `feeding_update`, `feeding_end`, `care_confirm` and `care_cancel`. The first pilot records bottle consumed ml/liquid type or direct-breastfeeding total minutes only.
- `mismatch` returns `identity_mismatch` without creating or mutating a session. `not_enrolled`, `unavailable` and `uncertain` may create reviewable typed state but only an authenticated same-actor browser can confirm it. `verified` never replaces lease authorization.
- A live request outside the two-minute window is rejected without state change. A valid signed `replay` start/update/end may only move typed state to `needs_review`; replay can never device-confirm a care fact.
- Do not persist or log raw audio, transcript, speaker embedding, similarity score, unrestricted note, model reasoning, keys, signatures, household network coordinates, filesystem paths or database coordinates.
- Device request bodies use a fixed 16 KiB maximum and strict canonical JSON. Unknown keys, duplicate keys, noncanonical bytes, malformed timestamps, non-integer care values, invalid base64url and unsupported versions fail closed before a state transition.
- `saved` is emitted only after the pending-session lock, existing feeding write, Voice Care linkage, audit row, receipt result and session `committed` state commit in one database transaction.
- Manual/PWA care remains available when any Voice Care component is absent. Do not add a supervisor dependency from Voice Care to Guardian, camera, audio, export, backup or restore.
- Voice Care is disabled by default behind one centralized startup setting. Tests may enable it only with generated keys and synthetic typed facts.
- Every implementation task follows RED -> observed expected failure -> minimal GREEN -> focused regression -> independent review -> exact local commit. Update this plan's task status and the authoritative handoff documents after each accepted task.
- Do not push, open a PR, merge, tag or run a household pilot without the separately applicable authorization. Never place real device keys, family data, audio or runtime state in Git or CI.

---

## Execution Preconditions

Before Task 1, create an isolated worktree using `superpowers:using-git-worktrees`, then run:

```bash
git branch --show-current
git merge-base --is-ancestor 936129e88d88f7810cfa18d730e1c3f3fe85cd73 HEAD
git status --short
node --version
pnpm --version
```

Expected: branch `codex/m5-voice-care-adapter-implementation`, ancestry exits 0, no unrelated tracked changes, Node 24 or newer and pnpm 10.17.1. Preserve ignored `.superpowers` reports, generated dependencies and every user-owned file. Read `agent.md`, `summary.md`, `.agent/current-milestone.json`, the M5 spec and this plan completely before editing.

## Architecture And Interface Map

### Shared intent contract

```ts
export type VoiceCareIntentType =
  | 'feeding_start'
  | 'feeding_update'
  | 'feeding_end'
  | 'care_confirm'
  | 'care_cancel';

export interface VoiceCareBottleProposalV1 {
  mode: 'bottle';
  startedAt: string;
  endedAt: string | null;
  liquidType: 'expressed_breast_milk' | 'formula' | null;
  amountMl: number | null;
  amountValueOrigin: 'spoken' | 'family_default' | null;
  bottleCapacityMl: number | null;
}

export interface VoiceCareDirectProposalV1 {
  mode: 'direct_breastfeeding';
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
}

export interface VoiceCareUnknownProposalV1 {
  mode: 'unknown';
  startedAt: string;
  endedAt: null;
}

export type VoiceCareFeedingProposalV1 =
  | VoiceCareBottleProposalV1
  | VoiceCareDirectProposalV1
  | VoiceCareUnknownProposalV1;

export type VoiceCareFeedingProposalInputV1 =
  | Omit<VoiceCareBottleProposalV1, 'amountValueOrigin'>
  | VoiceCareDirectProposalV1
  | VoiceCareUnknownProposalV1;

export interface VoiceCareIntentEnvelopeV1 {
  schemaVersion: 1;
  requestId: string;
  deviceId: string;
  leaseId: string;
  issuedAt: string;
  occurredAt: string;
  deliveryMode: 'live' | 'replay';
  careSessionId: string | null;
  speakerState: 'verified' | 'uncertain' | 'mismatch' | 'not_enrolled' | 'unavailable';
  source: 'voice';
  modelVersion: string;
  signature: string;
}

export type VoiceCareIntentV1 = VoiceCareIntentEnvelopeV1 & (
  | { intentType: 'feeding_start'; careSessionId: null; payload: {
      mode: VoiceCareFeedingProposalV1['mode']; startedAt: string;
    } }
  | { intentType: 'feeding_update'; careSessionId: string; payload: {
      expectedVersion: number; proposal: VoiceCareFeedingProposalInputV1;
    } }
  | { intentType: 'feeding_end'; careSessionId: string; payload: {
      expectedVersion: number;
      finalProposal: Exclude<VoiceCareFeedingProposalInputV1, VoiceCareUnknownProposalV1>;
    } }
  | { intentType: 'care_confirm'; careSessionId: string; payload: ConfirmVoiceCareSessionInput }
  | { intentType: 'care_cancel'; careSessionId: string; payload: CancelVoiceCareSessionInput }
);

export type PairVoiceCareDeviceSigningInput = Omit<PairVoiceCareDeviceInput, 'signature'>;

export function parseCanonicalVoiceCareIntentV1(raw: Uint8Array): VoiceCareIntentV1;
export function voiceCareSigningBytesV1(intent: VoiceCareIntentV1): Uint8Array;
export async function voiceCareProposalDigestV1(proposal: VoiceCareFeedingProposalV1): Promise<string>;
export function voiceCarePairingSigningBytesV1(input: PairVoiceCareDeviceSigningInput): Uint8Array;
```

The parser accepts UTF-8 canonical JSON only. It parses once, validates the closed discriminated union, canonicalizes recursively with lexicographically sorted object keys, compares the canonical full envelope bytes to the request bytes, and creates signing bytes by removing only `signature` and canonicalizing again.

### Browser/device boundaries

```text
browser + session + origin:
  POST   /api/voice-care/pairing-challenges
  POST   /api/voice-care/devices
  GET    /api/voice-care/state
  DELETE /api/voice-care/devices/:deviceId
  POST   /api/voice-care/devices/:deviceId/leases
  DELETE /api/voice-care/leases/:leaseId
  POST   /api/voice-care/sessions/:sessionId/confirm
  POST   /api/voice-care/sessions/:sessionId/cancel

device + canonical raw body + Ed25519 signature:
  POST   /api/voice-care/intents
  Content-Type: application/vnd.baby-care.voice-intent+json
```

### Service boundaries

```ts
export interface VoiceCareDeviceService {
  createChallenge(actor: CareActorContext): Promise<VoiceCarePairingChallengeDto>;
  pair(actor: CareActorContext, input: PairVoiceCareDeviceInput, traceId: string): Promise<VoiceCareDeviceDto>;
  list(actor: CareActorContext): Promise<VoiceCareDeviceDto[]>;
  revoke(actor: CareActorContext, deviceId: string, traceId: string): Promise<void>;
}

export interface VoiceCareLeaseService {
  activate(actor: CareActorContext, deviceId: string, input: ActivateVoiceCareLeaseInput, traceId: string): Promise<VoiceCareLeaseDto>;
  revoke(actor: CareActorContext, leaseId: string, traceId: string): Promise<void>;
}

export interface VoiceCareIntentService {
  accept(raw: Uint8Array, traceId: string, signal: AbortSignal): Promise<VoiceCareSemanticResultV1>;
}

export interface VoiceCareSessionService {
  state(actor: CareActorContext): Promise<VoiceCareStateDto>;
  confirmFromBrowser(actor: CareActorContext, sessionId: string, input: ConfirmVoiceCareSessionInput, traceId: string): Promise<VoiceCareSemanticResultV1>;
  cancelFromBrowser(actor: CareActorContext, sessionId: string, input: CancelVoiceCareSessionInput, traceId: string): Promise<VoiceCareSemanticResultV1>;
}
```

The browser DTOs are fixed:

```ts
export interface VoiceCarePairingChallengeDto {
  challengeId: string;
  challenge: string; // base64url, 32 generated bytes
  expiresAt: string;
}

export interface PairVoiceCareDeviceInput {
  challengeId: string;
  challenge: string; // base64url, exact 32 generated bytes returned by Baby Care
  deviceId: string; // UUID generated by Baby Local
  publicKey: string; // base64url, 32-byte Ed25519 raw key
  signature: string; // base64url, 64-byte signature over the fixed pairing bytes
}

export interface ActivateVoiceCareLeaseInput {
  clientRequestId: string;
  occurredAt: string;
}

export interface ConfirmVoiceCareSessionInput {
  proposalDigest: string;
  expectedVersion: number;
  warningDigest: string | null;
  confirmedWarningCodes: CareWarningCode[];
}

export interface CancelVoiceCareSessionInput {
  expectedVersion: number;
  reason: 'caregiver_cancelled' | 'duplicate' | 'incorrect_intent' | 'stale';
}
```

The device `care_confirm` payload has the same four confirmation fields. On the first
attempt `warningDigest` is null and `confirmedWarningCodes` is empty. If Baby Care
returns warnings, it increments the session version and returns an allow-listed warning
digest/code set; only a second confirmation binding that exact set may commit.

Pairing signature bytes are canonical JSON for exactly
`{ purpose: 'baby-care-voice-pair-v1', challengeId, challenge, deviceId, publicKey }`.
The server stores only `SHA-256(challenge)` and compares it before consuming the row;
the returned challenge is never written to audit or ordinary diagnostics.

### Durable state

```text
pending -> needs_confirmation -> committing -> committed
pending | needs_confirmation -> cancelled
pending | needs_confirmation -> needs_review
```

All transitions carry `expectedVersion`. Receipt key `(device_id, request_id)` has one request digest and one closed result. A duplicate with the same digest returns the stored result; the same key with different bytes returns `rejected` without revealing which field differed.

## File Map

### Contracts

- Create `packages/contracts/src/voice-care.ts` — strict device/browser DTOs, semantic results, canonical JSON/signing bytes and proposal digest.
- Modify `packages/contracts/src/care/common.ts` — add the distinct server-owned `voice` care source.
- Create `packages/contracts/schema/voice-care-intent.v1.schema.json` — deterministic published JSON Schema artifact.
- Create `packages/contracts/fixtures/voice-care-v1.json` — generated-key valid/invalid corpus with no transcript or household data.
- Create `packages/contracts/scripts/write-voice-care-schema.mjs` — writes only the fixed schema artifact and verifies byte stability.
- Modify `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/package.json`.
- Create `packages/contracts/test/voice-care.test.ts`, `packages/contracts/test/voice-care-golden.test.ts`.

### API, persistence and domain integration

- Create `migrations/0004_m5_voice_care.sql` and matching Drizzle journal/snapshot entries.
- Modify `apps/api/src/schema.ts`, `apps/api/src/config.ts`, `apps/api/src/startup.ts`, `apps/api/src/app.ts`.
- Create `apps/api/src/voice-care/errors.ts` — closed internal errors to semantic result mapping.
- Create `apps/api/src/voice-care/device-repository.ts`, `device-service.ts` — pairing and revocation.
- Create `apps/api/src/voice-care/lease-repository.ts`, `lease-service.ts` — active actor lease plus atomic handoff.
- Create `apps/api/src/voice-care/session-repository.ts`, `session-service.ts` — pending state and browser review.
- Create `apps/api/src/voice-care/intent-authenticator.ts`, `intent-coordinator.ts`, `intent-service.ts` — canonical signature, fixed rate/concurrency bounds, replay and transition orchestration.
- Create `apps/api/src/routes/voice-care-browser.ts`, `apps/api/src/routes/voice-care-device.ts`.
- Modify `apps/api/src/care/feeding-warnings.ts`, `feeding-service.ts`, `feeding-write-service.ts`, `care-event-repository.ts`, `handoff-repository.ts` only through the explicit transactional interfaces in Task 6.
- Create `apps/api/test/voice-care-contract.integration.test.ts`, `voice-care-device.integration.test.ts`, `voice-care-lease.integration.test.ts`, `voice-care-session.integration.test.ts`, `voice-care-promotion.integration.test.ts`, `voice-care-route.test.ts`, `m5-migrations.integration.test.ts`.

### Web/PWA

- Modify `apps/web/src/api-client.ts`, `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/app.css`.
- Create `apps/web/src/voice-care/VoiceCarePanel.tsx`, `VoiceCareDeviceControls.tsx`, `VoiceCarePendingSessions.tsx`.
- Create `apps/web/test/voice-care-panel.test.tsx`, `voice-care-responsive.test.tsx`.

### M4 compatibility and delivery

- Modify `packages/contracts/src/family-export.ts` and its tests for export schema v2 while keeping v1 parsing.
- Modify `apps/api/src/family/family-export-repository.ts`, `apps/api/src/operations/verify-restored-database.ts`.
- Modify `packages/operations/src/postgres-tools.ts`, `packages/operations/src/restore.ts` and focused tests for M5 invariants and restored lease/session revocation.
- Create `scripts/m5-voice-care-feeding-pilot.mjs` and `apps/api/test/m5-compose-smoke-contract.test.ts`.
- Modify `compose.yaml`, `.github/workflows/ci.yml`, `README.md`, `docs/PLAN.md`, `summary.md`, `.agent/current-milestone.json` only as actual gates advance.

---

### Task 1: M5.0 Strict Contracts, Canonical Bytes And Golden Corpus

**Status:** Complete at `bb1337226c1948695159d14199c9bb73cdaf115a`; Task 2 is next.

**Files:**

- Create: `packages/contracts/src/voice-care.ts`
- Create: `packages/contracts/schema/voice-care-intent.v1.schema.json`
- Create: `packages/contracts/fixtures/voice-care-v1.json`
- Create: `packages/contracts/scripts/write-voice-care-schema.ts`, `packages/contracts/scripts/write-voice-care-fixtures.ts`
- Modify: `packages/contracts/src/care/common.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/package.json`
- Test: `packages/contracts/test/voice-care.test.ts`, `packages/contracts/test/voice-care-golden.test.ts`

**Interfaces:**

- Consumes: existing offset timestamp, bottle liquid type, feeding component and warning-code contracts.
- Produces: `VoiceCareIntentV1Schema`, browser DTO schemas, `VoiceCareSemanticResultV1Schema`, `parseCanonicalVoiceCareIntentV1`, `voiceCareSigningBytesV1`, `voiceCareProposalDigestV1`, `voiceCarePairingSigningBytesV1`, tracked JSON Schema and golden corpus.

- [x] **Step 1: Write contract RED tests**

```ts
it('rejects unknown fields, duplicate keys, transcript fields and noncanonical bytes', () => {
  expect(() => parseCanonicalVoiceCareIntentV1(bytes('{"schemaVersion":1,"schemaVersion":1}'))).toThrow();
  expect(() => VoiceCareIntentV1Schema.parse({ ...validStart, transcript: 'synthetic words' })).toThrow();
  expect(() => parseCanonicalVoiceCareIntentV1(bytes(JSON.stringify(validStart, null, 2)))).toThrow();
});

it('binds every accepted field except signature into Ed25519 signing bytes', () => {
  const baseline = voiceCareSigningBytesV1(validStart);
  for (const mutate of acceptedFieldMutations) {
    expect(voiceCareSigningBytesV1(mutate(validStart))).not.toEqual(baseline);
  }
});
```

Cover all five intent discriminants; integer and upper bounds; exact base64url signature length; `source='voice'`; model label bounds; payload/intent mismatch; invalid UUID/time; unknown speaker state; invalid delivery mode; warning digest/code-set/expected-version shape; pairing domain separation and exact challenge/key/signature lengths; semantic response allow-list; and browser pairing/lease/session DTOs.

- [x] **Step 2: Run RED and record the first expected failure**

```bash
pnpm --filter @baby-care/contracts test -- voice-care.test.ts voice-care-golden.test.ts
```

Expected: FAIL because `voice-care.ts`, schema artifact and fixtures do not exist.

- [x] **Step 3: Implement the strict contract and canonicalizer**

```ts
export const VoiceCareSemanticCodeSchema = z.enum([
  'accepted_pending', 'saved', 'needs_identity', 'needs_confirmation',
  'identity_mismatch', 'state_conflict', 'temporarily_unavailable', 'rejected',
]);

export function parseCanonicalVoiceCareIntentV1(raw: Uint8Array): VoiceCareIntentV1 {
  if (raw.byteLength === 0 || raw.byteLength > 16_384) throw new VoiceCareContractError();
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const parsed: unknown = JSON.parse(decoded);
  const intent = VoiceCareIntentV1Schema.parse(parsed);
  if (!constantTimeBytesEqual(raw, canonicalJsonBytes(intent))) throw new VoiceCareContractError();
  return intent;
}
```

Use a closed recursive canonicalizer that accepts only null, booleans, safe integers, strings, arrays and plain objects. Do not use locale-sensitive sorting. Proposal digest is lowercase SHA-256 over canonical proposal bytes through Web Crypto and is separate from the request signature.

- [x] **Step 4: Generate and verify the tracked schema/corpus**

```bash
pnpm --filter @baby-care/contracts voice-care:schema
pnpm --filter @baby-care/contracts voice-care:schema:check
pnpm --filter @baby-care/contracts test -- voice-care.test.ts voice-care-golden.test.ts
pnpm --filter @baby-care/contracts typecheck
git diff --check
```

Expected: all focused tests PASS; a second schema write produces no diff. Confirm corpus values are synthetic and contain no transcript, name, private address, key or signature from a real device.

- [x] **Step 5: Review and commit Task 1**

```bash
git add packages/contracts/src/voice-care.ts packages/contracts/src/care/common.ts packages/contracts/src/index.ts packages/contracts/src/errors.ts packages/contracts/schema packages/contracts/fixtures packages/contracts/scripts packages/contracts/test/voice-care.test.ts packages/contracts/test/voice-care-golden.test.ts packages/contracts/package.json
git diff --cached --check
git commit -m "feat: define M5 Voice Care contracts"
```

**Completion:** Baby Care publishes one closed, byte-stable v1 contract and fixture corpus. No API route, device key or database table exists.

Fresh verification: 44 contract tests passed; schema and fixture byte-stability checks,
contracts typecheck, repository lint and `git diff --check` passed on Node 24.19.0.

---

### Task 2: M5.0 Database Schema And Fail-Closed Invariants

**Status:** Complete at `990c99f795d6a1b20188f2a1a86b792f9ede6c51`; Task 3 is next.

**Files:**

- Create: `migrations/0004_m5_voice_care.sql`
- Modify: `migrations/meta/_journal.json`, create the corresponding Drizzle snapshot, `apps/api/src/schema.ts`
- Test: `apps/api/test/m5-migrations.integration.test.ts`
- Modify: `apps/api/test/helpers/m2-family-app.ts` to truncate M5 tables in foreign-key order when present.

**Interfaces:**

- Consumes: Task 1 enums and existing family/baby/user/membership/handoff/care-event ownership.
- Produces: `voiceCareDevices`, `voiceCarePairingChallenges`, `voiceCareLeases`, `voiceCareIntentReceipts`, `voiceCareFeedingSessions` Drizzle tables and matching PostgreSQL constraints.

- [x] **Step 1: Write PostgreSQL migration RED tests**

```ts
it('creates all M5 tables and adds voice to care_source', async () => {
  const names = await publicTableNames(database.pool);
  expect(names).toEqual(expect.arrayContaining([
    'voice_care_devices', 'voice_care_pairing_challenges', 'voice_care_leases',
    'voice_care_intent_receipts', 'voice_care_feeding_sessions',
  ]));
  expect(await enumLabels(database.pool, 'care_source')).toContain('voice');
});

it('rejects cross-family lease ownership and a second active family/device lease', async () => {
  await seedValidDeviceAndLease(database.pool);
  await expect(insertSecondActiveLease(database.pool)).rejects.toMatchObject({ code: '23505' });
  await expect(insertCrossFamilyLease(database.pool)).rejects.toMatchObject({ code: '23503' });
});
```

Also prove: five-minute challenge/consumption fields; public-key length 32 bytes; key/device uniqueness; fixed capability/status values; positive session version; legal state/proposal/terminal combinations; receipt digest length 32; one event per Voice Care session; actor membership ownership; session device/lease/family/baby consistency; `manual` and `voice` care/checkpoint rows both require server-owned actor plus client request ID; and terminal states cannot have a missing required terminal timestamp.

- [x] **Step 2: Run RED**

```bash
env TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api test -- m5-migrations.integration.test.ts
```

Expected: FAIL because migration `0004` and M5 tables are absent. If `TEST_DATABASE_URL` is unavailable, start only the repository's disposable PostgreSQL 16 test service; do not use a household or production database.

- [x] **Step 3: Add the forward-only migration and Drizzle schema**

```sql
alter type care_source add value if not exists 'voice';

create table voice_care_devices (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete restrict,
  public_key bytea not null check (octet_length(public_key) = 32),
  capability text not null check (capability = 'voice_care.intent.submit'),
  status text not null check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (family_id, id),
  unique (public_key),
  check ((status = 'active' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);
```

Create the remaining four tables with composite foreign keys back to the family-owned device/lease/session rows. Store only typed JSON proposals/results validated at service boundaries; do not add raw request bodies, signatures, transcripts or speaker scores. Add partial unique indexes for an unrevoked family/device lease and a nonterminal session-to-final-event link. Replace the existing actor-required checks so both `manual` and `voice` care/checkpoint sources require actor user, membership and client request ID; preserve all other source meanings.

- [x] **Step 4: Run migration GREEN and compatibility gates**

```bash
env TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @baby-care/api test -- m5-migrations.integration.test.ts migrations.integration.test.ts m2-migrations.integration.test.ts m3-migrations.integration.test.ts
pnpm --filter @baby-care/api typecheck
git diff --check
```

Expected: all enabled PostgreSQL tests PASS and all earlier migrations remain valid.

- [x] **Step 5: Review and commit Task 2**

```bash
git add migrations apps/api/src/schema.ts apps/api/test/m5-migrations.integration.test.ts apps/api/test/helpers/m2-family-app.ts
git diff --cached --check
git commit -m "feat: add M5 Voice Care persistence"
```

**Completion:** The database can hold M5 security and pending state with ownership constraints. No pairing, lease or intent route exists.

Fresh PostgreSQL 16 evidence: M5 migration tests 7/7, M1-M5 migration compatibility
15/15 and the full UTC API suite 176/176 passed. Root typecheck, lint, API build,
Drizzle snapshot check and diff check passed. On the macOS Asia/Shanghai host, the
pre-existing M1 birth-date integration case returns the previous UTC calendar date;
the isolated test passes 2/2 under the CI `TZ=UTC` baseline. Task 2 did not alter that path.

---

### Task 3: M5.1 Browser-Authenticated Pairing And Device Revocation

**Status:** Complete at `e42ec50`; requires Tasks 1-2.

**Files:**

- Create: `apps/api/src/voice-care/errors.ts`, `device-repository.ts`, `device-service.ts`
- Create: `apps/api/src/routes/voice-care-browser.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/voice-care-device.integration.test.ts`, `apps/api/test/voice-care-route.test.ts`

**Interfaces:**

- Consumes: `CareAuth.requireRead/requireWrite`, family-admin permission, Task 1 pairing DTOs and Task 2 device/challenge tables.
- Produces: `createVoiceCareDeviceService(database, now, randomBytes)`, pairing/list/revoke browser routes and generated-key pairing fixtures.

- [x] **Step 1: Write pairing and authorization RED tests**

```ts
it('pairs a generated Ed25519 key after one valid five-minute challenge', async () => {
  const challenge = await postChallenge(app, dadCookie);
  const keyPair = generateKeyPairSync('ed25519');
  const input = signedPairingInput(challenge, keyPair);
  expect((await pairDevice(app, dadCookie, input)).statusCode).toBe(201);
  expect((await pairDevice(app, dadCookie, input)).statusCode).toBe(409);
});

it('does not allow Nanny to pair or revoke a device', async () => {
  expect((await postChallenge(app, nannyCookie)).statusCode).toBe(403);
  expect((await revokeDevice(app, nannyCookie, generatedDeviceId)).statusCode).toBe(403);
});
```

Cover expired, unknown and consumed challenge; wrong key/signature; malformed key; cross-family access; duplicate public key; revocation idempotency; device list excludes public key/challenge/signature; audit metadata allow-list; and browser origin/session enforcement.

- [x] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- voice-care-device.integration.test.ts voice-care-route.test.ts
```

Expected: FAIL because the device service and browser routes do not exist.

- [x] **Step 3: Implement pairing with fixed challenge bytes**

```ts
export function createVoiceCareDeviceService(
  database: DatabaseContext,
  now: () => Date = () => new Date(),
  random: (size: number) => Buffer = randomBytes,
): VoiceCareDeviceService {
  return {
    createChallenge: (actor) => createPairingChallenge(database, actor, random(32), now(), 5 * 60_000),
    pair: (actor, input, traceId) => pairGeneratedEd25519Device(database, actor, input, traceId, now()),
    list: (actor) => listFamilyDevices(database.pool, actor.familyId),
    revoke: (actor, deviceId, traceId) => revokeFamilyDeviceAndLeases(database, actor, deviceId, traceId, now()),
  };
}
```

Hash challenge bytes at rest, verify Ed25519 with the supplied 32-byte raw public key converted through a fixed SPKI prefix, consume challenge and insert device/audit in one transaction, and map all external failures to closed codes. Revoke the device and every unrevoked lease in the same transaction.

- [x] **Step 4: Run pairing GREEN**

```bash
pnpm --filter @baby-care/api test -- voice-care-device.integration.test.ts voice-care-route.test.ts security-primitives.test.ts family-authorization.integration.test.ts
pnpm --filter @baby-care/api typecheck
git diff --check
```

Expected: focused tests PASS; ordinary browser auth and family authorization remain unchanged.

- [x] **Step 5: Review and commit Task 3**

```bash
git add apps/api/src/voice-care apps/api/src/routes/voice-care-browser.ts apps/api/src/app.ts apps/api/test/voice-care-device.integration.test.ts apps/api/test/voice-care-route.test.ts
git diff --cached --check
git commit -m "feat: pair and revoke Voice Care devices"
```

**Completion:** Dad/Mom can pair and revoke a generated-key device. Device pairing grants no care-write path and stores no private key.

Fresh evidence: four focused API files passed 16/16 against disposable PostgreSQL 16;
API typecheck, root lint, API production build, staged diff and credential/privacy scans
passed. Pairing stores only the challenge digest and public key, device administration is
family-admin-only, cross-family device access fails closed, and revocation atomically
invalidates every open lease. Task 4 active-caregiver lease and handoff is next.

---

### Task 4: M5.2 Active Caregiver Lease And Atomic Handoff

**Status:** Complete at `4479902`; requires Tasks 1-3.

**Files:**

- Create: `apps/api/src/voice-care/lease-repository.ts`, `lease-service.ts`
- Modify: `apps/api/src/voice-care/device-repository.ts`, `apps/api/src/routes/voice-care-browser.ts`
- Modify: `apps/api/src/care/handoff-repository.ts` to expose a source-aware transactional insert without changing manual behavior.
- Test: `apps/api/test/voice-care-lease.integration.test.ts`, `apps/api/test/care-handoff.integration.test.ts`

**Interfaces:**

- Consumes: paired device, authenticated `CareActorContext`, existing handoff ownership and Task 1 lease DTOs.
- Produces: `createVoiceCareLeaseService`, `insertHandoffCheckpointInTransaction`, active lease lookup and lease activation/revocation routes.

- [x] **Step 1: Write lease RED tests**

```ts
it('atomically activates an eight-hour lease and a voice handoff checkpoint', async () => {
  const response = await activateLease(app, dadCookie, deviceId, { clientRequestId });
  expect(response.statusCode).toBe(201);
  expect(response.json().expiresAt).toBe('2026-08-23T16:00:00.000Z');
  expect(await activeLeaseCount(database.pool, deviceId)).toBe(1);
  expect(await handoffForClientRequest(database.pool, clientRequestId)).toMatchObject({ source: 'voice' });
});

it('rolls back the lease if handoff creation fails', async () => {
  await forceHandoffConstraintFailure(database.pool);
  await expect(leaseService.activate(actor, deviceId, input, traceId)).rejects.toThrow();
  expect(await activeLeaseCount(database.pool, deviceId)).toBe(0);
});
```

Cover replacement revokes prior lease; one family/device active lease under concurrency; Dad/Mom may revoke any family lease; Nanny may activate/revoke only their own; disabled membership, expired lease and revoked device are inactive; no silent renewal; cross-family access is closed; and the browser never receives a reusable session credential.

- [x] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- voice-care-lease.integration.test.ts care-handoff.integration.test.ts
```

Expected: FAIL because lease service/repository and source-aware handoff insertion are absent.

- [x] **Step 3: Implement transaction-scoped lease activation**

```ts
export async function insertHandoffCheckpointInTransaction(
  client: pg.PoolClient,
  input: {
    actor: CareActorContext;
    source: 'manual' | 'voice';
    occurredAt: Date;
    createdAt: Date;
    clientRequestId: string;
    traceId: string;
  },
): Promise<HandoffCheckpointRow>;
```

`activate` locks the family/device row, revalidates device and membership, revokes the old lease, inserts the `source='voice'` checkpoint, inserts the new lease with `expiresAt = issuedAt + 8h`, writes bounded audit metadata and commits once. Keep the existing manual handoff service calling the same helper with `source='manual'`.

- [x] **Step 4: Run lease GREEN**

```bash
pnpm --filter @baby-care/api test -- voice-care-lease.integration.test.ts care-handoff.integration.test.ts care-workspace-system.integration.test.ts
pnpm --filter @baby-care/api typecheck
git diff --check
```

Expected: lease tests PASS and existing manual handoff tests remain green.

- [x] **Step 5: Review and commit Task 4**

```bash
git add apps/api/src/voice-care apps/api/src/routes/voice-care-browser.ts apps/api/src/care/handoff-repository.ts apps/api/test/voice-care-lease.integration.test.ts apps/api/test/care-handoff.integration.test.ts
git diff --cached --check
git commit -m "feat: issue active caregiver voice leases"
```

**Completion:** A browser-authenticated caregiver can deliberately bind one paired device to themselves for at most eight hours, with an atomic handoff checkpoint. No device intent route exists.

Fresh evidence: the focused Task 4 compatibility set passed 21/21, the corrected Task 3
cross-family fixture passed 4/4 without leaving its schema index removed, and the full
UTC API suite passed 43 files / 192 tests against disposable PostgreSQL 16. API
typecheck, root lint, production build, diff and privacy scans passed. Activation writes
the voice handoff, lease and bounded audits in one transaction; replacement is serialized
by the device row, replay does not renew, and disabled/expired/revoked/cross-family
authority fails closed. Task 5 signed device intents and pending feeding state is next.

---

### Task 5: M5.3 Signed Device Endpoint And Pending Feeding State Machine

**Status:** Pending; requires Tasks 1-4.

**Files:**

- Create: `apps/api/src/voice-care/intent-authenticator.ts`, `intent-coordinator.ts`, `intent-service.ts`, `session-repository.ts`, `session-service.ts`
- Create: `apps/api/src/routes/voice-care-device.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/src/startup.ts`
- Test: `apps/api/test/voice-care-contract.integration.test.ts`, `voice-care-session.integration.test.ts`, `voice-care-route.test.ts`, `config.test.ts`, `startup.test.ts`

**Interfaces:**

- Consumes: canonical intent parser/signing bytes, Ed25519 device key, active lease lookup, receipt/session tables and centralized application configuration.
- Produces: `VoiceCareIntentAuthenticator.authenticate(raw, now)`, `VoiceCareIntentService.accept`, `VoiceCareSessionService.state`, device route, `VOICE_CARE_ENABLED=false` and fixed operational bounds.

- [ ] **Step 1: Write endpoint/authentication RED tests**

```ts
it('accepts one canonical signed live start and creates no care event', async () => {
  const response = await postSignedIntent(app, signedStart({ speakerState: 'verified' }));
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ code: 'accepted_pending', careSessionId: expect.any(String) });
  expect(await countRows(database.pool, 'voice_care_feeding_sessions')).toBe(1);
  expect(await countRows(database.pool, 'care_events')).toBe(0);
});

it.each(['bad_signature', 'revoked_device', 'expired_lease', 'cross_family'])('%s creates no state', async (caseName) => {
  const before = await voiceCareCounts(database.pool);
  expect((await postCase(caseName)).json()).toMatchObject({ code: expect.stringMatching(/^(rejected|needs_identity)$/) });
  expect(await voiceCareCounts(database.pool)).toEqual(before);
});
```

Cover the exact 16 KiB body limit/media type; duplicate keys/noncanonical body rejected before DB; two-minute live window; replay/out-of-window never auto-commits; device/request same digest returns stored result; different digest returns `rejected`; capability/revocation/lease/membership checks; uncertain/mismatch/not-enrolled/unavailable speaker outcomes; rate/concurrency bounds; abort settlement; disabled-by-default startup; and stable errors with no identity enumeration.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- voice-care-contract.integration.test.ts voice-care-session.integration.test.ts voice-care-route.test.ts config.test.ts startup.test.ts
```

Expected: FAIL because the device route, authenticator, state machine and setting do not exist.

- [ ] **Step 3: Implement raw canonical authentication and receipt transaction**

```ts
export interface AuthenticatedVoiceIntent {
  intent: VoiceCareIntentV1;
  requestDigest: Buffer;
  device: { id: string; familyId: string };
  actor: CareActorContext;
  lease: { id: string; expiresAt: Date };
}

export interface VoiceCareIntentAuthenticator {
  authenticate(raw: Uint8Array, acceptedAt: Date): Promise<AuthenticatedVoiceIntent>;
}
```

Register a fixed parser for `application/vnd.baby-care.voice-intent+json` with `parseAs: 'buffer'` and `bodyLimit: 16_384`; do not replace ordinary JSON parsing. Verify canonical bytes and Ed25519 before interpreting payload state. Use one per-device in-flight slot, a 30-attempt rolling-minute limiter and a 30-second abort-aware deadline; release the slot only after database work settles. Use a constant external rejection shape for all device/key/lease lookup failures.

- [ ] **Step 4: Implement only noncommitting transitions**

```ts
export type VoiceCareSessionState =
  | 'pending'
  | 'needs_confirmation'
  | 'needs_review'
  | 'cancelled'
  | 'committing'
  | 'committed';

export async function applyPendingVoiceIntent(
  client: pg.PoolClient,
  authenticated: AuthenticatedVoiceIntent,
  acceptedAt: Date,
): Promise<VoiceCareSemanticResultV1>;
```

In Task 5, `feeding_start`, `feeding_update`, `feeding_end` and `care_cancel` are implemented; device `care_confirm` returns `needs_confirmation` without a final write until Task 6. Start creates a typed proposal; update uses `expectedVersion`; end freezes `proposalDigest`; cancel is terminal. The device cannot submit `amountValueOrigin`: Baby Care sets `spoken` for a submitted amount, and may set `family_default` only for a value read from a future server-owned configuration. M5 adds no new default-setting surface. A six-hour sweep runs opportunistically inside bounded state reads/transitions and moves eligible nonterminal rows to `needs_review` without inventing care facts.

- [ ] **Step 5: Run state-machine GREEN**

```bash
pnpm --filter @baby-care/api test -- voice-care-contract.integration.test.ts voice-care-session.integration.test.ts voice-care-route.test.ts config.test.ts startup.test.ts
pnpm --filter @baby-care/api typecheck
pnpm --filter @baby-care/contracts test -- voice-care.test.ts voice-care-golden.test.ts
git diff --check
```

Expected: focused tests PASS and every Task 5 path leaves `care_events` unchanged.

- [ ] **Step 6: Review and commit Task 5**

```bash
git add apps/api/src/voice-care apps/api/src/routes/voice-care-device.ts apps/api/src/app.ts apps/api/src/config.ts apps/api/src/startup.ts apps/api/test/voice-care-contract.integration.test.ts apps/api/test/voice-care-session.integration.test.ts apps/api/test/voice-care-route.test.ts apps/api/test/config.test.ts apps/api/test/startup.test.ts
git diff --cached --check
git commit -m "feat: accept pending Voice Care feeding intents"
```

**Completion:** A valid leased device can create/update/end/cancel a typed pending feeding session with replay protection. No Voice Care request can yet create a final care event.

---

### Task 6: M5.4 Transactional Confirmation And Existing Feeding Promotion

**Status:** Pending; requires Task 5.

**Files:**

- Modify: `apps/api/src/care/feeding-warnings.ts`, `feeding-service.ts`, `feeding-write-service.ts`, `care-event-repository.ts`
- Modify: `apps/api/src/voice-care/session-service.ts`, `session-repository.ts`, `intent-service.ts`, `routes/voice-care-browser.ts`
- Test: `apps/api/test/voice-care-promotion.integration.test.ts`, `feeding-warning.integration.test.ts`, `feeding-bottle.integration.test.ts`, `feeding-direct.integration.test.ts`, `care-concurrency.integration.test.ts`

**Interfaces:**

- Consumes: frozen proposal digest/version, valid lease actor and existing feeding warnings/writer.
- Produces: `prepareFeedingWarnings`, `writeFeedingSessionInTransaction`, `promoteVoiceCareFeeding`, device/browser confirmation and exactly-once final linkage.

- [ ] **Step 1: Write promotion RED tests**

```ts
it('commits one voice feeding event and returns saved only after commit', async () => {
  const pending = await endedBottleSession({ amountMl: 90, liquidType: 'formula' });
  const result = await confirmSigned(pending, { proposalDigest: pending.digest, expectedVersion: pending.version });
  expect(result).toMatchObject({ code: 'saved', careEventId: expect.any(String) });
  expect(await linkedVoiceEvents(database.pool, pending.id)).toHaveLength(1);
  expect((await linkedVoiceEvents(database.pool, pending.id))[0]).toMatchObject({ source: 'voice', amount_ml: 90 });
});

it('creates one event under concurrent duplicate confirms', async () => {
  const results = await Promise.all([confirmSameSession(), confirmSameSession()]);
  expect(results.filter((value) => value.code === 'saved')).toHaveLength(2);
  expect(await linkedVoiceEventCount(database.pool, sessionId)).toBe(1);
});
```

Cover bottle amount is consumed ml; capacity excluded from totals; expressed/formula distinct; direct breastfeeding minutes and no inferred ml; default proposal never committed without exact confirmation; warning codes/digest/version bound; changed warning set requires reconfirmation; mismatch/not-enrolled/unavailable cannot device-confirm; uncertain requires authenticated browser confirmation; expired/revoked lease blocks device confirm; rollback/audit failure never returns `saved`; request abort settles transaction before slot release; manual feeding, warnings and idempotency remain unchanged.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- voice-care-promotion.integration.test.ts feeding-warning.integration.test.ts feeding-bottle.integration.test.ts feeding-direct.integration.test.ts care-concurrency.integration.test.ts
```

Expected: FAIL because Voice Care confirm has no transactional promotion path.

- [ ] **Step 3: Refactor the existing writer without changing manual semantics**

```ts
type QueryExecutor = Pick<pg.Pool | pg.PoolClient, 'query'>;

export async function collectFeedingWarnings(
  executor: QueryExecutor,
  actor: CareActorContext,
  input: CreateFeedingSessionInput,
  now: Date,
): Promise<CareWarning[]>;

export async function writeFeedingSessionInTransaction(
  client: pg.PoolClient,
  actor: CareActorContext,
  input: CreateFeedingSessionInput,
  traceId: string,
  source: 'manual' | 'voice',
): Promise<FeedingSessionDto>;
```

Keep `FeedingService.createSession` as the manual transaction owner and pass `source='manual'`. Extend the care-event writer to accept only a server-owned source argument; routes and device payloads never supply it.

- [ ] **Step 4: Implement atomic Voice Care promotion**

```ts
export async function promoteVoiceCareFeeding(
  client: pg.PoolClient,
  authenticated: AuthenticatedVoiceIntent,
  confirmation: VoiceCareConfirmationV1,
  traceId: string,
  now: Date,
): Promise<VoiceCareSemanticResultV1>;
```

Begin one transaction, lock the session and receipt, revalidate device/lease/membership, compare version/proposal/warning digests, mark `committing`, call `writeFeedingSessionInTransaction`, link event/session, write allow-listed audit and receipt result, mark `committed`, then commit. A retry reads the committed receipt/session link and returns the same `saved` result without writing again. Browser confirmation authenticates the same session actor; Dad/Mom may cancel but cannot silently confirm another actor's session.

- [ ] **Step 5: Run promotion GREEN and prior-care regression**

```bash
pnpm --filter @baby-care/api test -- voice-care-promotion.integration.test.ts feeding-warning.integration.test.ts feeding-bottle.integration.test.ts feeding-direct.integration.test.ts care-concurrency.integration.test.ts care-event.integration.test.ts care-workspace-system.integration.test.ts
pnpm --filter @baby-care/api typecheck
git diff --check
```

Expected: all focused tests PASS; manual and voice paths share domain semantics but retain distinct server-owned sources.

- [ ] **Step 6: Review and commit Task 6**

```bash
git add apps/api/src/care apps/api/src/voice-care apps/api/src/routes/voice-care-browser.ts apps/api/test/voice-care-promotion.integration.test.ts apps/api/test/feeding-warning.integration.test.ts apps/api/test/feeding-bottle.integration.test.ts apps/api/test/feeding-direct.integration.test.ts apps/api/test/care-concurrency.integration.test.ts
git diff --cached --check
git commit -m "feat: confirm Voice Care feeding records"
```

**Completion:** Exact confirmed bottle/direct proposals promote through existing care rules into exactly one `source=voice` event. `saved` is transactionally honest.

---

### Task 7: M5.5 Responsive Web Review, Lease And Cancellation Panel

**Status:** Pending; requires Tasks 3-6.

**Files:**

- Create: `apps/web/src/voice-care/VoiceCarePanel.tsx`, `VoiceCareDeviceControls.tsx`, `VoiceCarePendingSessions.tsx`
- Modify: `apps/web/src/api-client.ts`, `apps/web/src/auth/AuthenticatedShell.tsx`, `apps/web/src/app.css`
- Test: `apps/web/test/voice-care-panel.test.tsx`, `voice-care-responsive.test.tsx`, `App.test.tsx`, `care-workspace.test.tsx`

**Interfaces:**

- Consumes: browser pairing/device/lease/state/confirm/cancel routes and session permission context.
- Produces: typed `BabyCareApi` methods and a Voice Care panel that reveals typed care facts but no transcript/key/signature/model detail.

- [ ] **Step 1: Write Web RED tests**

```tsx
it('lets Dad activate his lease and review a typed pending bottle', async () => {
  render(<AuthenticatedShell api={api} session={dadSession} onLogout={vi.fn()} />);
  await user.click(await screen.findByRole('button', { name: '在这台设备上由我照护' }));
  expect(await screen.findByText('当前语音照护者：Dad')).toBeVisible();
  expect(await screen.findByText('配方奶 90 ml')).toBeVisible();
  expect(screen.queryByText(/transcript|signature|public.?key|modelVersion/i)).not.toBeInTheDocument();
});

it('does not expose pairing/revocation controls to Nanny', async () => {
  render(<AuthenticatedShell api={api} session={nannySession} onLogout={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '配对语音设备' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '撤销设备' })).not.toBeInTheDocument();
});
```

Cover the operator-assisted first-pilot pairing exchange (copy one strict challenge bundle from Baby Care, paste one strict signed response bundle from Baby Local, never handle a private key); loading/error/retry; explicit lease stop; actor/expiry visibility; same-actor confirm/cancel; Dad/Mom stale cancellation; cross-actor confirm absent; warning readback; committed timeline link; iPhone-width overflow/tap targets; night mode; request abort/stale response protection; and existing quick-record/timeline/detail/undo remaining mounted.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/web test -- voice-care-panel.test.tsx voice-care-responsive.test.tsx App.test.tsx care-workspace.test.tsx
```

Expected: FAIL because Voice Care Web components and API methods do not exist.

- [ ] **Step 3: Implement the typed API methods and panel**

```ts
export interface BabyCareApi {
  getVoiceCareState(): Promise<VoiceCareStateDto>;
  createVoiceCarePairingChallenge(): Promise<VoiceCarePairingChallengeDto>;
  pairVoiceCareDevice(input: PairVoiceCareDeviceInput): Promise<VoiceCareDeviceDto>;
  revokeVoiceCareDevice(deviceId: string): Promise<void>;
  activateVoiceCareLease(deviceId: string, input: ActivateVoiceCareLeaseInput): Promise<VoiceCareLeaseDto>;
  revokeVoiceCareLease(leaseId: string): Promise<void>;
  confirmVoiceCareSession(sessionId: string, input: ConfirmVoiceCareSessionInput): Promise<VoiceCareSemanticResultV1>;
  cancelVoiceCareSession(sessionId: string, input: CancelVoiceCareSessionInput): Promise<VoiceCareSemanticResultV1>;
}
```

Render only server DTO fields. The first pilot uses an explicit copy/paste challenge/response exchange between the two local admin pages; do not add discovery, cloud relay or a Baby Local private-key export. Use an explicit confirmation dialog for warnings and device revocation. Do not render/store the one-time challenge after pairing completion; do not place public key material in DOM diagnostics or local storage.

- [ ] **Step 4: Run Web GREEN**

```bash
pnpm --filter @baby-care/web test -- voice-care-panel.test.tsx voice-care-responsive.test.tsx App.test.tsx care-workspace.test.tsx care-history-correction.test.tsx
pnpm --filter @baby-care/web typecheck
pnpm --filter @baby-care/web build
git diff --check
```

Expected: focused tests, typecheck and production build PASS with existing care workspace behavior intact.

- [ ] **Step 5: Review and commit Task 7**

```bash
git add apps/web/src/voice-care apps/web/src/api-client.ts apps/web/src/auth/AuthenticatedShell.tsx apps/web/src/app.css apps/web/test/voice-care-panel.test.tsx apps/web/test/voice-care-responsive.test.tsx apps/web/test/App.test.tsx apps/web/test/care-workspace.test.tsx
git diff --cached --check
git commit -m "feat: add Voice Care review controls"
```

**Completion:** Dad/Mom/Nanny can see and control only their permitted typed Voice Care state on desktop and iPhone layouts. Existing manual care remains the primary fallback.

---

### Task 8: M5.6 Family Export V2, Backup And Isolated Restore Closure

**Status:** Pending; requires Tasks 2 and 6.

**Files:**

- Modify: `packages/contracts/src/family-export.ts`, `packages/contracts/test/family-export.test.ts`
- Modify: `apps/api/src/family/family-export-repository.ts`, `apps/api/test/family-export-service.test.ts`, `family-export.integration.test.ts`, `family-export-route.test.ts`
- Modify: `apps/api/src/operations/verify-restored-database.ts`, `apps/api/test/restored-database-verifier.integration.test.ts`
- Modify: `packages/operations/src/postgres-tools.ts`, `packages/operations/src/restore.ts`
- Modify: `packages/operations/test/backup.test.ts`, `restore.test.ts`, `restore.integration.test.ts`
- Modify: `scripts/m4-birth-ready-operations.mjs`, `apps/api/test/m4-compose-smoke-contract.test.ts` so the existing M4 gate accepts the current v2 export while retaining its original M1-M4 assertions.

**Interfaces:**

- Consumes: M5 tables/final links and the completed M4 export/backup/restore boundaries.
- Produces: `FamilyExportSchemaV2`, `VoiceCareExportSessionSchemaV1`, M5 restore invariants and transactionally invalidated restored Voice Care authority.

- [ ] **Step 1: Write export/restore RED tests**

```ts
it('exports typed Voice Care session history without security material', async () => {
  const document = await exportGeneratedM5Family();
  expect(document.schemaVersion).toBe(2);
  expect(document.voiceCareSessions[0]).toMatchObject({
    state: 'committed',
    proposal: { mode: 'bottle', liquidType: 'formula', amountMl: 90 },
    confirmationMethod: 'device',
  });
  expect(JSON.stringify(document)).not.toMatch(/publicKey|signature|challenge|leaseId|requestId|modelVersion/);
});

it('revokes restored leases and moves nonterminal voice sessions to needs_review', async () => {
  const report = await verifyRestoredM5Database(restoredDatabase);
  expect(report.activeVoiceCareLeaseCount).toBe(0);
  expect(report.actionableVoiceCareSessionCount).toBe(0);
  expect(await committedVoiceEventDigest(restoredDatabase)).toBe(sourceDigest);
});
```

Cover v1 export parsing unchanged; v2 deterministic ordering; pending/committed/cancelled/review history; no public key/signature/challenge/receipt/security identifiers; M5 ownership and proposal/event consistency; migration fingerprint includes `0004`; backup manifest/content remain complete; restore keeps committed facts/revisions; all leases revoked; nonterminal sessions become `needs_review` with `restoreInvalidatedAt`; sanitation writes no care/audit/family/user history; read models accept `source=voice`; and the existing M4 production script parses v2 without weakening any M4 marker or stable-fact comparison.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/contracts test -- family-export.test.ts
pnpm --filter @baby-care/api test -- family-export-service.test.ts family-export.integration.test.ts family-export-route.test.ts restored-database-verifier.integration.test.ts m4-compose-smoke-contract.test.ts
pnpm --filter @baby-care/operations test -- backup.test.ts restore.test.ts restore.integration.test.ts
```

Expected: FAIL because export v2 and M5 restore checks/sanitation do not exist.

- [ ] **Step 3: Add versioned export DTO and deterministic repository reads**

```ts
export const VoiceCareExportSessionSchemaV1 = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid(),
  actorMembershipId: z.string().uuid(),
  actorDisplayName: z.string().min(1),
  state: z.enum(['pending', 'needs_confirmation', 'needs_review', 'cancelled', 'committed']),
  proposal: VoiceCareFeedingProposalV1Schema,
  confirmationMethod: z.enum(['device', 'browser']).nullable(),
  finalCareEventId: z.string().uuid().nullable(),
  startedAt: OffsetDateTimeSchema,
  endedAt: OffsetDateTimeSchema.nullable(),
  confirmedAt: OffsetDateTimeSchema.nullable(),
  cancelledAt: OffsetDateTimeSchema.nullable(),
}).strict();

export const FamilyExportSchemaV2 = FamilyExportSchemaV1.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal(2),
  voiceCareSessions: z.array(VoiceCareExportSessionSchemaV1),
}).strict();
```

Export only durable semantic history. Omit devices, challenges, leases, receipts, signatures, request IDs, speaker state/model labels and security timestamps. Sort sessions by `startedAt`, then ID. Keep `FamilyExportSchemaV1` exported for old-file validation.

- [ ] **Step 4: Extend restore invariants and sanitation**

```ts
export interface RestoreInvariantReport {
  existingM4Facts: ExistingM4RestoreFacts;
  voiceCare: {
    invalidOwnershipCount: 0;
    invalidFinalLinkCount: 0;
    invalidProposalCount: 0;
    activeLeaseCountBeforeSanitation: number;
  };
}

export interface RestoreSanitationReport {
  revokedSessionCount: number;
  revokedVoiceCareLeaseCount: number;
  invalidatedVoiceCareSessionCount: number;
}
```

Run M5 invariant reads before sanitation in the same existing restore verification boundary. In the fixed sanitation transaction revoke ordinary login sessions, revoke every Voice Care lease, and move only `pending`/`needs_confirmation`/`committing` Voice Care sessions to `needs_review` with `restore_invalidated_at`. Recheck zero active authority and unchanged committed care digests before declaring the restore usable.

- [ ] **Step 5: Run M4/M5 compatibility GREEN**

```bash
pnpm --filter @baby-care/contracts test -- family-export.test.ts
pnpm --filter @baby-care/api test -- family-export-service.test.ts family-export.integration.test.ts family-export-route.test.ts restored-database-verifier.integration.test.ts m4-compose-smoke-contract.test.ts
pnpm --filter @baby-care/operations test -- backup.test.ts restore.test.ts restore.integration.test.ts
env BABY_CARE_PG16_INTEGRATION=1 pnpm --filter @baby-care/operations test -- restore.integration.test.ts
pnpm typecheck
git diff --check
```

Expected: software and enabled disposable PostgreSQL 16 gates PASS; no production or household backup is opened.

- [ ] **Step 6: Review and commit Task 8**

```bash
git add packages/contracts/src/family-export.ts packages/contracts/test/family-export.test.ts apps/api/src/family/family-export-repository.ts apps/api/src/operations/verify-restored-database.ts apps/api/test/family-export-service.test.ts apps/api/test/family-export.integration.test.ts apps/api/test/family-export-route.test.ts apps/api/test/restored-database-verifier.integration.test.ts apps/api/test/m4-compose-smoke-contract.test.ts packages/operations/src/postgres-tools.ts packages/operations/src/restore.ts packages/operations/test/backup.test.ts packages/operations/test/restore.test.ts packages/operations/test/restore.integration.test.ts scripts/m4-birth-ready-operations.mjs
git diff --cached --check
git commit -m "feat: preserve M5 data safety and recovery"
```

**Completion:** Family export v2 contains useful typed Voice Care history without security material, and M4 backup/restore proves restored Voice Care cannot retain active authority.

---

### Task 9: M5.7 Synthetic Production And Cross-Repository Contract Gate

**Status:** Pending; requires Tasks 1-8 and the separately implemented Baby Local consumer of the exact Task 1 schema/corpus.

**Files:**

- Create: `scripts/m5-voice-care-feeding-pilot.mjs`, `scripts/check-voice-care-consumer.mjs`
- Create: `apps/api/test/m5-compose-smoke-contract.test.ts`
- Modify: `compose.yaml`, `.github/workflows/ci.yml`, `scripts/collect-diagnostics.mjs` and observability tests only for fixed M5 markers/counters.
- Modify: `README.md`, `docs/PLAN.md`, `summary.md`, `.agent/current-milestone.json` after gates actually pass.

**Interfaces:**

- Consumes: full M1-M5 production build, generated Ed25519 keys, Task 1 artifacts, Task 8 backup/restore, and a separately verified Baby Local checkout.
- Produces: four ordered M5 smoke markers, cross-repository schema/corpus digest evidence and exact-head CI acceptance.

- [ ] **Step 1: Write static smoke/privacy RED tests**

```ts
const M5_MARKERS = [
  'SMOKE_OK component=m5-device-lease',
  'SMOKE_OK component=m5-feeding-confirm',
  'SMOKE_OK component=m5-recovery',
  'SMOKE_OK component=m5-voice-care-feeding-pilot',
];

it('emits each fixed M5 marker once and never logs semantic values', () => {
  expect(source).toContain("'SMOKE_OK component=m5-device-lease'");
  expect(source).not.toMatch(/console\.(log|error).*?(amountMl|displayName|proposal|publicKey|signature)/s);
});
```

Also require existing M1-M4 markers; production mode; generated key only; exact semantic response order; duplicate confirmation one event; lease/device revocation; manual Nanny write after Voice Care failure; export/backup/restore; teardown ownership; bounded child output; and no raw payload/key/path/error in diagnostics.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @baby-care/api test -- m5-compose-smoke-contract.test.ts
pnpm --filter @baby-care/observability test -- collect-diagnostics-privacy.test.ts
```

Expected: FAIL because the M5 production script and markers do not exist.

- [ ] **Step 3: Implement the fixed generated-data production script**

```js
const M5_MARKERS = Object.freeze([
  'SMOKE_OK component=m5-device-lease',
  'SMOKE_OK component=m5-feeding-confirm',
  'SMOKE_OK component=m5-recovery',
  'SMOKE_OK component=m5-voice-care-feeding-pilot',
]);

const generatedDevice = generateKeyPairSync('ed25519');
```

Reuse the M4 script's bounded subprocess, private temporary directory, project ownership and exact marker discipline rather than weakening it. Build a fresh family, pair generated device, activate Dad lease/handoff, submit signed bottle start/update/end/confirm, verify one event and duplicate result, cancel a second session, reject expired/revoked authority, create manual Nanny care, export, backup, isolated restore and verify M5 sanitation. Output only fixed markers and closed failure codes.

- [ ] **Step 4: Implement the read-only cross-repository verifier**

```js
// Usage: node scripts/check-voice-care-consumer.mjs /absolute/path/to/baby-monitor-local
// Output is exactly one of:
// CONTRACT_OK schema=voice-care-intent.v1 corpus=voice-care-v1
// CONTRACT_FAIL code=consumer_missing|schema_mismatch|corpus_mismatch|consumer_dirty
```

Resolve the supplied directory, reject symlinks and dirty tracked consumer state, read only the fixed Baby Local vendored schema/corpus/source-commit files, compare bytes/digests, and never print either absolute path or digest. This script does not modify Baby Local. If CI can authenticate to both repositories, check out Baby Local as a sibling at its recorded exact commit; otherwise M5.7 remains pending until the same command is recorded locally against both clean exact heads.

- [ ] **Step 5: Run production and cross-repository GREEN**

```bash
pnpm --filter @baby-care/api test -- m5-compose-smoke-contract.test.ts
pnpm --filter @baby-care/observability test -- collect-diagnostics-privacy.test.ts
node scripts/check-voice-care-consumer.mjs ../baby-monitor-local
docker compose build
node scripts/compose-smoke.mjs
node scripts/m4-birth-ready-operations.mjs
node scripts/m5-voice-care-feeding-pilot.mjs
docker compose ps --all
docker compose down --volumes --remove-orphans
```

Expected: contracts match; M1-M5 markers appear exactly once in order; generated flow PASS; the final owned Compose project has no containers/volumes left. Do not run teardown against an unowned project or household database.

- [ ] **Step 6: Run the full software gate and exact-head CI**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
git status --short
```

After local review and separately authorized push, require exact remote-head jobs for static checks, unit tests, PostgreSQL integration, production build and production Compose smoke. Record the local implementation SHA and remote CI SHA separately if publication creates a different commit.

- [ ] **Step 7: Review and commit Task 9**

```bash
git add scripts/m5-voice-care-feeding-pilot.mjs scripts/check-voice-care-consumer.mjs apps/api/test/m5-compose-smoke-contract.test.ts compose.yaml .github/workflows/ci.yml scripts/collect-diagnostics.mjs packages/observability/test README.md docs/PLAN.md summary.md .agent/current-milestone.json
git diff --cached --check
git commit -m "test: prove the M5 feeding pilot"
```

**Completion:** Exact synthetic facts prove the production Baby Care loop, M4 recovery and a byte-identical Baby Local consumer. This does not prove household microphone accuracy or real-device operation.

---

### Task 10: M5.8 Adult-Only Supervised Pilot And Release Checkpoint

**Status:** Human-gated; requires exact-head Task 9 CI and a separately accepted Baby Local Voice Care runtime. No infant is required or permitted as the first subject.

**Files:**

- Modify: `docs/PLAN.md`, `summary.md`, `.agent/current-milestone.json`
- Create only if the repository's established ignored evidence workflow requires it: `.superpowers/sdd/2026-08-23-m5-voice-care-feeding-pilot/human-acceptance-report.md`
- Do not add household screenshots, audio, transcripts, device IDs, keys, private addresses or database files.

**Interfaces:**

- Consumes: installed exact M5 Baby Care head, installed exact Baby Local head, one paired Xiaomi/Baby Local device and authenticated Dad/Mom/Nanny browsers.
- Produces: aggregate adult-only acceptance evidence and a release decision; no new product behavior.

- [ ] **Step 1: Verify exact installed identities before household interaction**

```bash
git status --short
git rev-parse HEAD
gh run list --branch codex/m5-voice-care-adapter-implementation --limit 3
```

Expected: clean tracked worktree; installed source SHA equals the accepted exact-head CI SHA; all required jobs PASS. In Baby Local, record its clean exact SHA and software/installed audio status through its existing redacted status commands.

- [ ] **Step 2: Run the adult-only supervised scenario**

Perform at least ten generated/adult-spoken trials split across day/night and Dad/Mom:

```text
pair -> activate Dad -> bottle start/update/end -> exact readback -> confirm -> timeline
cancel second pending session -> verify no care event
Mom takeover -> direct breastfeeding minutes -> confirm -> timeline
network interruption before confirm -> verify no saved acknowledgement -> PWA review
device revocation -> verify later signed intent rejected -> manual Nanny record still succeeds
```

Use non-medical synthetic care values. Keep the device in adult reach, keep the PWA open and verify each final fact manually. Do not retain audio/transcripts or use a real infant event as acceptance data.

- [ ] **Step 3: Record only bounded aggregate evidence**

```text
trial_count=<integer>
false_activation_count=<integer>
needs_confirmation_count=<integer>
abandoned_pending_count=<integer>
correction_count=<integer>
duplicate_final_event_count=0
wrong_actor_count=0
saved_before_commit_count=0
manual_fallback_failures=0
```

Record the exact Baby Care/Baby Local SHAs, software gate IDs and pass/fail decision. Do not record spoken words, timestamps precise enough to reveal household routine, names, care values or private coordinates.

- [ ] **Step 4: Apply the release rule**

```text
PASS only if duplicate_final_event_count=0,
wrong_actor_count=0,
saved_before_commit_count=0,
manual_fallback_failures=0,
and every failed/uncertain trial remained pending/reviewable or rejected.
```

Any identity ambiguity, fabricated success, lost manual functionality, raw-audio persistence or unreviewable pending state blocks release. Do not lower the rule after a failed trial.

- [ ] **Step 5: Update the durable checkpoint and commit documents**

```bash
jq empty .agent/current-milestone.json
git diff --check
git add docs/PLAN.md summary.md .agent/current-milestone.json
git commit -m "docs: record M5 supervised acceptance"
```

**Completion:** M5 is accepted only with separate software, cross-repository and adult-supervised evidence. It still does not claim infant safety, medical accuracy, unattended care or support for additional voice care kinds.

---

## Full Completion Gate

Before describing M5 software as complete, run fresh evidence at the exact implementation head:

```bash
pnpm --filter @baby-care/contracts voice-care:schema:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
env BABY_CARE_PG16_INTEGRATION=1 pnpm --filter @baby-care/operations test -- restore.integration.test.ts
node scripts/check-voice-care-consumer.mjs ../baby-monitor-local
node scripts/m5-voice-care-feeding-pilot.mjs
jq empty .agent/current-milestone.json
git diff --check
git status --short
```

Then scan the exact tracked diff and history for private keys, credentials, private network literals, audio/video/media files, transcripts, SQLite/PostgreSQL data, generated settings and local absolute deployment paths. Resolve the local Baby Local checkout explicitly when executing the read-only consumer check; the verifier must never print or persist that path.

Software evidence proves strict contracts, authorization, exactly-once database semantics, privacy boundaries, responsive Web behavior and synthetic production recovery. It does not prove Xiaomi microphone quality, wake/ASR accuracy in the household, speaker-observation quality, real-device network stability, two-phone usability or safe unattended care; Tasks 9-10 record those gates separately.

## Ordered Delivery After M5

Do not add care kinds merely because the shared envelope exists. After the feeding pilot is accepted, use its aggregate confirmation/correction burden to decide the next independent design:

1. voice query/correction/undo;
2. low-risk diaper/burping typed intents;
3. sleep and other time-interval intents;
4. medication only under a separate exact-field/readback specification;
5. Guardian normalized-event read integration under a separate read-only adapter specification.

Camera backchannel speech, cry/emotion classification, visual feeding inference, cloud speech and speaker identity as authorization remain outside this plan.
