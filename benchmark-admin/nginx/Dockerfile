FROM node:22-alpine AS web-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY .npmrc pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json    ./apps/web/
COPY packages/server/package.json ./packages/server/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @benchmark-admin/web build

FROM nginx:1.27-alpine
COPY --from=web-builder /app/apps/web/dist /usr/share/nginx/html
COPY nginx/default.conf     /etc/nginx/conf.d/default.conf
COPY nginx/default-ssl.conf /etc/nginx/conf.d/default-ssl.conf
EXPOSE 80 443
