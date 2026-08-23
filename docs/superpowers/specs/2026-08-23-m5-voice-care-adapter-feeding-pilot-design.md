# M5 Voice Care Adapter And Feeding Pilot Design

Status: approved on 2026-08-23; implementation plan pending review

Date: 2026-08-23

Repository: `lpearf-pixel/baby-care`

Baseline: `codex/m3-care-workspace-implementation @ cebd5d35c6095b08982216ccc706f0226e710dbc`

## 1. Mission

M5 adds the Baby Care half of the local Voice Care loop. A paired Baby Local device may
submit a signed, typed semantic intent. Baby Care authenticates the device, resolves a
time-limited active caregiver lease, records a pending feeding session, applies the
existing feeding rules and commits one authoritative care record only after explicit
confirmation.

The first closed-loop pilot is feeding only:

```text
authenticated caregiver activates a device lease in Baby Care
-> Baby Local detects "小小" and derives a typed feeding intent locally
-> Baby Care authenticates device + lease and opens a pending session
-> Baby Local speaks only Baby Care's closed semantic response
-> caregiver finishes and confirms the typed feeding facts
-> Baby Care commits through the existing feeding service
-> existing timeline, edit, revision and void-based undo remain authoritative
```

Manual Web/PWA recording remains fully usable when Voice Care, Baby Local, the camera,
the network or any model is unavailable.

## 2. Relationship To The Cross-Product Voice Care Design

This design consumes the approved Baby Local specification
`docs/superpowers/specs/2026-08-19-voice-care-v1-design.md` from
`baby-monitor-local` and narrows its Baby Care-owned behavior.

One identity rule is intentionally stricter and supersedes the older cross-product text
for Baby Care authorization:

- local speaker matching is an observation, not authoritative identity;
- Baby Care never chooses Dad, Mom or Nanny from a voice profile or similarity score;
- a valid Baby Care-issued active caregiver lease is the only Voice Care actor source;
- without a valid lease, a request may be rejected or held for authenticated review,
  but it cannot create a handoff checkpoint or final care record.

Baby Local may still use speaker state to fail closed locally. If it transmits that
state, Baby Care may require more confirmation, but `verified` never grants authority or
changes the lease-bound actor.

## 3. Scope

### 3.1 Included

- Baby Local device pairing with one family-scoped Ed25519 public key;
- fixed Voice Care device capabilities and revocation;
- authenticated creation and revocation of an active caregiver lease;
- a durable pending feeding-session state machine;
- signed `feeding_start`, `feeding_update`, `feeding_end`, `care_confirm` and
  `care_cancel` intents;
- bottle feeding with actual consumed ml and liquid type;
- direct breastfeeding with total minutes only;
- closed semantic result codes for local acknowledgement;
- a Dad/Mom/Nanny Web review surface for their own pending session;
- family-admin visibility and cancellation of stale sessions;
- promotion through existing feeding validation, warning and write services;
- source, actor, device, lease, confirmation and audit provenance;
- M4 family-export and restore-invariant compatibility;
- generated/synthetic cross-repository fixtures and a production Compose gate.

### 3.2 Deferred

- voice query, post-commit voice correction and voice undo;
- diaper, sleep, bathing, burping, spit-up and measurement intents;
- medication voice recording;
- speaker-profile enrollment as an authorization mechanism;
- camera backchannel output;
- cry or emotion classification;
- Guardian visual inference of feeding type, amount or completion;
- free-form assistant chat, model-authored care facts or model prose in Baby Care;
- cloud speech, raw audio upload or transcript retention;
- broad event-bus infrastructure, cloud deployment or `main` integration.

Later care kinds reuse the v1 trust and delivery envelope behind independent gates.
Medication requires a separate exact-field/readback design and is not enabled by M5.

## 4. Ownership And Trust Boundary

### 4.1 Baby Local owns

- Xiaomi audio ingest, bounded memory-only audio and local model health;
- VAD, exact normalized `小小` prefix, ASR and optional speaker observations;
- conversion from transient transcript to a closed typed intent;
- device private key custody;
- a bounded encrypted delivery queue while Baby Care is unavailable;
- mapping Baby Care semantic codes to allow-listed local phrases.

### 4.2 Baby Care owns

- family, baby, membership, permission and active-caregiver identity;
- device public key, family scope, capability and revocation state;
- active caregiver leases and handoff checkpoint linkage;
- pending feeding sessions and legal state transitions;
- typed feeding validation, warnings, confirmation and final transaction;
- final event attribution, timeline, revisions, undo, export and audit.

### 4.3 Prohibited trust

Baby Care does not trust caller-supplied family, baby, user, membership or permission
identifiers. It derives them from the paired device and active lease. It does not accept
raw audio, transcripts, embeddings, unrestricted notes, model reasoning, filesystem
paths, camera/account details or household network configuration.

## 5. Chosen Architecture

M5 uses a dedicated candidate/session boundary rather than sending device requests
directly to existing care-write routes.

```text
signed VoiceCareIntentV1
  -> device signature/replay gate
  -> active caregiver lease gate
  -> closed intent parser
  -> pending voice feeding session
  -> deterministic transition + confirmation gate
  -> existing feeding service transaction
  -> committed care event with source=voice
```

Alternatives rejected for v1:

- **Direct intent-to-care write:** smaller, but delayed, uncertain and partial speech
  cannot be reconciled safely and acknowledgement can race the final commit.
- **Generic event bus:** extensible, but adds delivery infrastructure and operational
  failure modes that a one-family feeding pilot does not need.

The candidate/session layer has one purpose: hold typed, non-authoritative Voice Care
state until Baby Care can either promote it through existing domain rules or close it
without a care fact.

## 6. Device Pairing

Pairing begins from an authenticated Dad/Mom family-admin session.

1. Baby Local creates an Ed25519 key in its approved Keychain-backed store.
2. Baby Care creates a random one-time challenge with a five-minute expiry.
3. Baby Local returns its opaque device ID, public key and challenge signature.
4. Baby Care binds the key to the current family with only
   `voice_care.intent.submit` capability.
5. The challenge is consumed atomically and cannot be replayed.

Pairing never grants family administration, export, backup, restore, membership or
credential capabilities. Baby Care stores no device private key, voice embedding,
audio or transcript. A family admin can revoke a device; revocation immediately
invalidates its leases and blocks all subsequent intent transitions.

Public keys, signatures and pairing challenges are security metadata. They are not
returned by family export or ordinary diagnostics.

## 7. Active Caregiver Lease

An authenticated Dad, Mom or active Nanny may activate Voice Care for themselves on a
paired device. Issuance uses their ordinary browser session and the existing care-write
permission. It cannot be initiated by a voice intent.

Lease rules are fixed for v1:

- one active lease per family/device;
- actor, family and baby are resolved from the authenticated session;
- fixed maximum age: eight hours;
- no silent renewal;
- a new lease atomically revokes the previous lease on that device;
- logout does not silently transfer the lease;
- disabled membership, device revocation or explicit termination invalidates it;
- Dad/Mom may revoke any family lease; Nanny may revoke only their own;
- activation creates the existing caregiver handoff checkpoint in the same transaction
  or fails without issuing a lease.

The device receives an opaque lease ID and expiry, not a browser cookie or reusable
caregiver credential. A speaker observation cannot extend, replace or reassign a lease.

## 8. Versioned Contract

Baby Care publishes a strict JSON Schema artifact from `packages/contracts`:

```text
voice-care-intent.v1.schema.json
```

Baby Local vendors the exact artifact together with the Baby Care source commit and
SHA-256. Both repositories run the same golden valid/invalid fixture corpus.

The v1 envelope is:

```text
VoiceCareIntentV1
  schemaVersion: 1
  requestId: UUID
  deviceId: bounded opaque ID
  leaseId: UUID
  issuedAt: offset timestamp
  occurredAt: offset timestamp
  deliveryMode: live | replay
  intentType:
    feeding_start | feeding_update | feeding_end | care_confirm | care_cancel
  careSessionId: UUID | null
  speakerState: verified | uncertain | mismatch | not_enrolled | unavailable
  payload: strict intent-specific object
  source: voice
  modelVersion: bounded non-secret label
  signature: detached Ed25519 signature
```

The signature covers a canonical byte representation of every field except
`signature`. Unknown keys, duplicate JSON keys, noncanonical numbers, overlong strings,
non-finite values and unsupported versions fail closed.

`speakerState` never identifies the actor. `mismatch` returns `identity_mismatch` and
does not create or mutate a session. `not_enrolled`, `unavailable` and `uncertain` may
hold a typed proposal for authenticated browser confirmation, but cannot device-confirm
it. `verified` only clears this additional confirmation gate after the lease has already
resolved the actor.

Payloads are closed:

- `feeding_start`: proposed feeding mode or `unknown`, start time;
- `feeding_update`: bottle liquid type, proposed actual consumed ml, optional bottle
  capacity, or a direct-breastfeeding elapsed-minutes proposal;
- `feeding_end`: typed final proposal and end time;
- `care_confirm`: exact proposal digest, expected session version, nullable warning
  digest and an exact closed set of confirmed warning codes;
- `care_cancel`: expected session version and closed cancellation reason.

No payload carries free-form transcript or model reasoning. M5 does not accept a note
field from the device.

## 9. Request Authentication And Replay Control

The device endpoint is separate from browser cookie authentication.

For every request Baby Care:

1. parses bounded raw bytes before JSON use;
2. resolves one active paired device by opaque ID;
3. verifies Ed25519 signature over canonical bytes;
4. checks device capability and revocation;
5. checks the lease, membership and family binding;
6. inserts a unique `(device_id, request_id)` receipt;
7. runs one legal state transition;
8. commits the receipt and result with the transition.

Live requests must be within a fixed two-minute clock window; an out-of-window request
is rejected without changing session state. A valid `replay` start/update/end may only
create or move typed state to `needs_review` and can never device-confirm a care fact.
A duplicated request returns the previous closed result and never repeats a write or
acknowledgement transition.

Rate and concurrency limits are fixed server bounds, not caller settings. Rejected
requests expose stable codes without revealing whether a device, lease or membership
exists.

## 10. Feeding Session State Machine

States are:

```text
pending
-> needs_confirmation
-> committing
-> committed

pending | needs_confirmation
-> cancelled

pending | needs_confirmation
-> needs_review
```

Terminal states never reopen. Every transition uses `expectedVersion`; concurrent
transitions have one winner.

### 10.1 Start

`feeding_start` creates a durable pending session. It records server-derived actor,
family and baby, device/lease references, source, accepted start time and request ID.
It does not create a care event.

A configured bottle amount may be attached only as a proposal with
`valueOrigin=family_default`. It is never treated as consumed milk.

### 10.2 Update and finish

Updates modify only the pending typed proposal. Bottle feeding requires liquid type and
actual consumed ml. Bottle capacity remains optional metadata and never enters intake
totals. Direct breastfeeding requires total minutes and never inferred ml or left/right
segments.

`feeding_end` freezes a proposal digest and moves to `needs_confirmation`. Baby Care
returns an allow-listed semantic readback payload containing only the critical typed
values required for local TTS.

### 10.3 Confirm

`care_confirm` must present the frozen proposal digest, current version, same active
lease-bound membership and an allowed speaker state. Baby Care reruns existing feeding
validation and warning rules.

If warnings require confirmation, the session stays `needs_confirmation`, advances its
version and stores a digest of the closed warning set. The device cannot invent or
suppress warning codes. A later explicit confirmation must bind that exact warning
digest, warning-code set, proposal digest and current session version. The first
confirmation attempt carries a null warning digest and no confirmed warning codes.

The final transaction:

- locks the pending session;
- verifies lease, proposal digest, version and terminal state;
- calls the existing feeding write service with server-derived actor;
- writes `source=voice` and the device request ID as idempotency provenance;
- links the committed care event to the Voice Care session;
- writes allow-listed audit metadata;
- marks the session `committed`;
- commits before returning `saved`.

No code path emits `saved` before that transaction commits.

### 10.4 Cancel, expiry and review

`care_cancel` closes a pending session without creating a care event. A session that is
still pending after six hours becomes `needs_review`; expiry never uses a default or
partial proposal. Lease expiry during a session prevents device confirmation. The same
authenticated membership may review or cancel it in the PWA; it must explicitly renew
the lease before voice confirmation.

M5 does not let one caregiver silently commit another caregiver's pending session.
Dad/Mom may cancel stale family sessions. Reassignment or cross-caregiver confirmation
requires a later explicit design.

## 11. Semantic Response Contract

The device receives one closed result:

- `accepted_pending`
- `saved`
- `needs_identity`
- `needs_confirmation`
- `identity_mismatch`
- `state_conflict`
- `temporarily_unavailable`
- `rejected`

Optional response data is a strict semantic template ID plus typed critical values; it
never includes raw exceptions, database details, keys, signatures, paths, model scores
or unrestricted prose.

Baby Local owns phrase rendering. Only `saved` may map to “已经记录”. A transport
timeout or unavailable response maps to “还没有保存，请稍后确认” and must not be
upgraded locally.

## 12. Web/PWA Surface

The authenticated care workspace adds a small Voice Care panel:

- paired-device status without public-key material;
- “在这台设备上由我照护” lease activation and explicit stop;
- lease actor and expiry visible to all family caregivers;
- pending/needs-confirmation/needs-review sessions visible without transcript;
- same-actor typed proposal review, confirm and cancel;
- Dad/Mom device revocation and stale-session cancellation;
- link to the final timeline item after commit.

The panel reuses current responsive, one-handed and night-mode behavior. It does not
play raw audio, show ASR transcripts, expose model scores or replace existing quick
recording.

## 13. Persistence And Migration

M5 introduces narrowly owned tables for:

- paired Voice Care devices and one-time pairing challenges;
- active/revoked caregiver leases;
- intent receipts and their closed results;
- pending Voice Care feeding sessions and versioned typed proposals.

Database constraints enforce family ownership, device/request uniqueness, one active
lease per family/device, positive session versions, legal terminal links and at most one
final care event per Voice Care session.

`care_source` adds the distinct value `voice`; existing meanings remain unchanged.

Migration is forward-only and keeps Voice Care disabled by default. Rollback means
disabling the endpoints/worker integration while preserving tables and committed care
history; it never deletes household records.

M4 compatibility requirements:

- PostgreSQL backup automatically includes the new tables;
- restore invariants validate their ownership, state and final-event linkage;
- restored sessions and Voice Care leases are revoked before successful restore
  verification;
- family export advances to a versioned schema that includes typed semantic session
  history and confirmation provenance but excludes keys, signatures and security
  metadata;
- old M4 export remains readable as its original version.

## 14. Privacy And Diagnostics

Baby Care persists only typed semantic fields required by the care workflow. It never
persists household audio, ASR transcript, speaker embedding, similarity score or model
reasoning.

Logs and diagnostics expose only stable codes and bounded aggregates such as accepted,
rejected, needs-confirmation, committed, cancelled, replayed and expired counts. They do
not expose typed care values, names, IDs, payloads, keys, signatures, private addresses
or endpoint configuration.

Test media is generated, synthetic or explicitly public. Household audio, real
transcripts, device credentials and family data never enter Git, CI fixtures, issues or
reports.

## 15. Failure Handling

- Baby Local unavailable: manual Baby Care continues unchanged.
- Baby Care unavailable: no success result; queued delivery cannot auto-commit stale
  facts.
- invalid signature/replay/revoked device: stable rejection and no state transition.
- missing/expired lease: `needs_identity`; no actor guess.
- uncertain/mismatched speaker state: confirmation/rejection; no final write.
- validation warning: session stays pending on exact warning codes.
- database/audit failure: transaction rolls back; result is not `saved`.
- TTS failure: Baby Care state remains authoritative and visible in PWA.
- duplicate/concurrent confirm: one final event; all retries return the winning result.
- restore: all device sessions and caregiver leases remain revoked until explicitly
  re-established.

Voice Care failure never restarts or degrades manual care, family export, backup,
restore, Guardian viewing, environment monitoring or camera recording.

## 16. Verification Strategy

### 16.1 Contract gate

- strict valid/invalid schema fixtures and generated JSON Schema digest;
- unknown/overlong/raw-transcript-like fields rejected;
- canonical signature bytes shared across TypeScript and Baby Local fixtures;
- the same golden corpus passes in both repositories.

### 16.2 Domain and database gate

- all legal/illegal state transitions;
- fixed lease expiry/revocation and membership-disable behavior;
- cross-family/device/lease mismatch rejection;
- request idempotency and concurrent finalization with one winner;
- default bottle amount never becomes intake without confirmation;
- bottle capacity never enters intake totals;
- direct breastfeeding never creates inferred ml;
- warning confirmation binds exact version and warning set;
- `saved` is observable only after commit;
- migration fingerprint, backup, restore and export invariants include M5 data.

### 16.3 API/security gate

- signed requests, canonical bytes, timestamp window and capability checks;
- unsigned, malformed, replayed, revoked and delayed requests fail closed;
- browser cookie cannot substitute for device signature and device credential cannot
  call browser/admin/export/backup routes;
- origin, rate, size, timeout and redacted error contracts;
- abort/cancellation settles database work before actor/device slots release.

### 16.4 Web gate

- Dad/Mom/Nanny can activate and stop only their permitted lease;
- Nanny cannot pair/revoke a device or access family-admin controls;
- pending proposal contains typed facts and no transcript/model details;
- same-actor confirm/cancel and Dad/Mom stale cancellation;
- existing manual quick-entry, timeline, edit and void undo remain unchanged;
- iPhone and night-mode layouts remain usable.

### 16.5 Production simulation

A generated Dad/Mom/Nanny flow proves:

```text
pair device
-> activate Dad lease + handoff
-> feeding_start
-> bottle update/end
-> exact readback + confirm
-> one voice-attributed final event
-> duplicate confirm returns same result
-> cancel a second pending session
-> expire/revoke lease and reject later intent
-> manual Nanny care still works
-> export/backup/isolated restore preserve M5 invariants
```

The gate uses generated keys and typed fixtures only. It persists no audio or
transcript. Existing M1-M4 markers remain required.

### 16.6 Human pilot

After exact-head CI and Baby Local synthetic contract gates, Dad and Mom perform an
adult-only supervised day/night feeding simulation with no infant required. The pilot
covers pairing, lease takeover, bottle, direct breastfeeding, cancel, correction via
existing PWA, device/network outage and revocation. A single successful demo is not
enough; repeated trials record only aggregate false activation, confirmation,
abandonment and correction outcomes.

## 17. Stage Gates

1. **M5.0 Contracts and golden fixtures** — Baby Care publishes the closed v1 schema.
2. **M5.1 Device pairing and revocation** — generated-key security gate passes.
3. **M5.2 Active caregiver lease** — authenticated handoff/expiry/revocation passes.
4. **M5.3 Pending feeding state machine** — no final care write is possible yet.
5. **M5.4 Confirmed feeding promotion** — existing feeding rules produce one event.
6. **M5.5 Web review and cancellation** — no transcript/model detail in the DOM.
7. **M5.6 Export, backup and isolated restore closure** — M4 invariants remain green.
8. **M5.7 Cross-repository synthetic production gate** — both exact schema digests
   match and the full generated flow passes.
9. **M5.8 Adult-only supervised pilot** — separate human acceptance evidence.

Each software stage uses RED -> GREEN, focused tests, independent review and an exact
commit. M5 does not proceed to additional care kinds until the feeding pilot's
confirmation workload and failure behavior are accepted.

## 18. Acceptance Criteria

M5 software release is complete only when:

- no unpaired, revoked, replayed, cross-family or lease-less request creates a handoff,
  pending session or final event;
- speaker output never selects the authoritative actor;
- retries and concurrency create at most one final feeding event;
- `saved` is impossible before the final transaction commit;
- manual care works with all Voice Care components unavailable;
- no raw audio, transcript, embedding, key, signature or private endpoint enters Baby
  Care persistence, logs, export, diagnostics or Git;
- feeding semantics and existing warning/revision/undo behavior remain unchanged;
- M4 export, backup and isolated restore gates pass with M5 data;
- exact-head CI passes static, unit, PostgreSQL integration, build and production
  Compose smoke;
- the adult-only supervised pilot is recorded separately and does not claim infant or
  medical safety.

## 19. Delivery Boundary

Specification approval authorizes only a detailed implementation plan. It does not
authorize implementation, real device pairing, household audio capture, push, PR,
merge, `main` modification or release tagging.

Implementation must begin on a separately approved M5 implementation branch from the
verified M3/M4 integration baseline. Baby Care contract work precedes Baby Local
delivery integration. No task may weaken existing manual-care, privacy, backup or
restore gates to obtain a green result.
