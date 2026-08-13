FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
RUN pnpm install --no-frozen-lockfile

COPY apps/api apps/api
COPY packages/contracts packages/contracts
COPY packages/observability packages/observability

EXPOSE 8787
CMD ["pnpm", "--filter", "@baby-care/api", "dev"]
