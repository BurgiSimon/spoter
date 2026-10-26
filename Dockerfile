# syntax=docker/dockerfile:1.7
# One image, three roles: web (default), worker (node dist/worker.mjs), migrations (node dist/migrate.mjs).

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm next build && pnpm build:worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 spoter && adduser -S -u 1001 -G spoter spoter
COPY --from=build --chown=spoter:spoter /app/.next/standalone ./
COPY --from=build --chown=spoter:spoter /app/.next/static ./.next/static
COPY --from=build --chown=spoter:spoter /app/public ./public
COPY --from=build --chown=spoter:spoter /app/dist ./dist
COPY --from=build --chown=spoter:spoter /app/drizzle ./drizzle
USER spoter
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
