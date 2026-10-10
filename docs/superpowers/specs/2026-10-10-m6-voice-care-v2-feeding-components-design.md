# M6 Voice Care v2 multi-component feeding contract

## Scope

Voice Care v2 extends the existing signed Voice Care v1 feeding boundary without
changing v1 parsing or persistence semantics. A single v2 session may contain
multiple components:

- `bottle / expressed_breast_milk / amountMl`
- `bottle / formula / amountMl`
- `direct_breastfeeding / durationMinutes`

`amountMl` is actual expressed or formula bottle intake only. Direct breastfeeding
is represented by duration and is never converted to millilitres or a default
quantity.

## Authority and lifecycle

The v2 Gateway reuses the existing device signature, active caregiver Lease,
request receipt deduplication, optimistic version, warning confirmation,
transaction commit, audit and revision rules. A start/update/end proposal is
non-committing. Only an explicit matching confirmation can commit a care event;
duplicate confirmation returns the committed result only when digest, warning
codes and version match. Lease, identity, digest, version, database and output
failures remain closed and retryable without creating a false care fact.

The eight-second local dialogue window is not the server session lifetime. Local
context expiry requires an explicit resume for additional components, but does
not delete or cancel the server-side pending task.

## Compatibility and privacy

v1 remains the default-compatible single-proposal contract. v2 uses canonical
schema version 2 bytes and a generated JSON Schema artifact. Tests use synthetic
proposals only; no household audio, transcript, device key or database is stored.

## Acceptance boundary

Offline evidence must prove the synthetic flow `expressed breast milk 60 ml +
formula 30 ml -> explicit confirm -> one committed 90 ml total across two
components`, and separately prove that direct breastfeeding commits duration only.
This is not family-device or production-database acceptance.
