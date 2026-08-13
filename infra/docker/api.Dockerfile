FROM node:24-alpine

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @baby-care/api build

ENV NODE_ENV=production
EXPOSE 8787
CMD ["pnpm", "--filter", "@baby-care/api", "start"]
