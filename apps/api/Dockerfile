FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY infra/postgres infra/postgres
RUN npm run build -w @baby-care/shared && npm run build -w @baby-care/api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8787 APP_TIMEZONE=Asia/Shanghai BABY_DISPLAY_NAME=xiangxiang
EXPOSE 8787
CMD ["node", "apps/api/dist/index.js"]
