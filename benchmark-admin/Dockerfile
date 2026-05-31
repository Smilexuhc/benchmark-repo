# ── builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json    ./apps/web/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @benchmark-admin/app-server... build

# ── runtime ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS api
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json    ./apps/web/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/apps/server/dist     ./apps/server/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
