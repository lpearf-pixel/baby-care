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

## Project context

Before changing the project, read:

1. `agent.md`
2. `docs/PLAN.md`
3. the relevant spec/implementation plan under `docs/superpowers/`

M2 care-recording interaction defaults must not be finalized until the family's real care habits have been collected.
