# syntax=docker/dockerfile:1
# Two runtime targets from one build:
# - `production`: the web server only. Next.js standalone output (traced server files), static
#   assets and public files. No pnpm, npm, tsx, TypeScript sources or build tooling.
# - `ops`: one-off jobs (Payload migrations, bootstrap and CI scripts run with tsx). Production
#   dependencies and sources, no Next.js build; never serves traffic.
FROM node:24.22.3-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/pnpm/corepack
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.28.2 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --store-dir /pnpm/store

FROM dependencies AS builder
# Only application inputs invalidate compilation; docs and deployment scripts do not.
COPY src ./src
COPY public ./public
COPY next.config.mjs tsconfig.json postcss.config.mjs site.config.json ./
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
# Deliberately unreachable database and dummy values: no production secret at build time.
RUN PAYLOAD_SECRET=build-only-placeholder-not-a-runtime-secret-000000 \
    DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    APP_URL=http://localhost pnpm build

FROM dependencies AS runtime-dependencies
# Reuse the same store; pruning without it can download dependencies again. The Next.js compiler
# (@next/swc) is only used by `next build`/`next dev`; the one-off jobs never load it.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    CI=true pnpm install --prod --frozen-lockfile --prefer-offline --store-dir /pnpm/store \
    && rm -rf node_modules/.pnpm/@next+swc-*

# Shared by both runtime targets: Node.js without its bundled package managers, user 1001.
# The code belongs to root and is only readable by user 1001: a compromised process cannot
# change it. User 1001 owns only what it must write (the media volume, and Next.js caches below).
FROM node:24.22.3-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 MEDIA_DIR=/app/storage/media
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    && groupadd --gid 1001 app && useradd --uid 1001 --gid app --no-create-home app \
    && mkdir -p /app/storage/media && chown app:app /app/storage/media
WORKDIR /app

FROM runtime AS ops
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json site.config.json ./
USER app
CMD ["node", "--import", "tsx", "node_modules/payload/bin.js", "--disable-transpile", "migrate"]

# Last stage: the default target is the web image.
FROM runtime AS production
# The port comes from compose (PORT, site.config.json).
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Next.js writes its page cache at run time (docker-compose.prod.yml mounts both in memory).
RUN mkdir -p .next/cache .next/server/route-cache \
    && chown app:app .next/cache .next/server/route-cache
USER app
CMD ["node", "server.js"]
