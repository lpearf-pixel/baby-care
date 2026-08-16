# Baby Care

Family newborn-care workspace for `xiangxiang`. Birth Ready is Web/PWA first and keeps Baby Care independently deployable from Baby Guardian.

## Prerequisites

- Node.js 24+
- pnpm 10.17.1
- Docker with Docker Compose

## Verify without Docker

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The PostgreSQL integration test runs automatically in CI with a real PostgreSQL service. Locally it runs when `TEST_DATABASE_URL` is set.

## Start the local family stack

```bash
docker compose up -d --build
node scripts/compose-smoke.mjs
```

Open:

- Web/PWA: `http://localhost:8080`
- API health through Web: `http://localhost:8080/api/health`

Stop without deleting the persistent local database volume:

```bash
docker compose down
```

For disposable testing only, remove the database volume as well:

```bash
docker compose down -v
```

## Operational family flow

On an empty database, the Web/API stack supports first-run family setup, Dad/Mom administrator accounts, Nanny caregiver access, revocable cookie sessions, server-enforced authorization, and audit history.

After login, Dad, Mom, and an active Nanny can use the care workspace for `xiangxiang`:

- bottle feeding records **actual consumed ml** separately from optional bottle capacity;
- expressed breast milk and formula are distinct bottle-feeding types;
- direct breastfeeding records the session's **total minutes only**;
- bottle quick values are learned independently for formula and expressed milk from recent real records instead of using fixed 90/150/200ml intake defaults;
- diaper changes support urine / stool / urine+stool plus optional stool color, consistency, and amount;
- sleep can be started or ended now, 10/20/30 minutes ago, or at a custom time;
- frequent facts include burping, spit-up, crying, bathing, temperature, weight, and medication actually administered;
- medication is a factual record only: Baby Care does not recommend a medication or calculate a dose;
- possible duplicates, unusual values, old backfill, and sleep overlap require explicit confirmation instead of silent normalization;
- the home summary uses a rolling 24-hour window and never counts bottle capacity as intake;
- recent care records can be corrected or voided without deleting the original history;
- care attribution comes from the authenticated server session, not from client-supplied family/baby/actor identifiers.

The production-mode Docker Compose smoke starts from an empty PostgreSQL volume and exercises setup, authentication/authorization, feeding, diaper, sleep, summary, edit/undo, and Nanny attribution through the real Web/API container route.

## Privacy and diagnostics

Care audit metadata is intentionally bounded. CI compact diagnostics redact care values and session/setup secrets before storing bounded failure evidence. Raw session tokens are not stored in PostgreSQL; only session token hashes are persisted.

## Project context

Before changing the project, read:

1. `agent.md`
2. `docs/PLAN.md`
3. the relevant spec/implementation plan under `docs/superpowers/`

The family's real M2 care habits have been collected and encoded in the approved M2 design. M3 must build on those recorded facts rather than redefining M2 interaction assumptions. Guardian/JoyAI/Qwen integration remains outside M2 and requires its own later milestone/design.
