# Baby Care

Baby Care is the Web/PWA family care workspace for `xiangxiang`, built as part of **程序员爸爸的科学育儿实验室**.

Current milestone: **M0 Repository and Delivery Foundation**.

## Development baseline

- Node.js 22
- npm workspaces
- React/Vite Web/PWA
- Fastify API
- PostgreSQL 16
- Docker Compose

## Local stack

Copy `.env.example` to `.env` only when local overrides are needed. The Compose defaults are sufficient for development:

```bash
npm install
docker compose up --build
```

Web: `http://localhost:8080`
API liveness: `http://localhost:8787/health/live`
API readiness: `http://localhost:8787/health/ready`

## Verification

```bash
npm run verify:focused
npm run test:integration
```

GitHub Actions is the authoritative software verification environment. On failures, inspect compact `diagnostics/latest/` artifacts before reading raw logs.

Read `agent.md` and `docs/PLAN.md` before implementation work.
