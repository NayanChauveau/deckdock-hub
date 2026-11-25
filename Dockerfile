# syntax=docker/dockerfile:1
# Two runtime targets from one build:
# - `production`: the web server only. Next.js standalone output (traced server files), static
#   assets and public files. No pnpm, npm, tsx, TypeScript sources or build tooling.
# - `ops`: one-off jobs (Payload migrations, bootstrap and CI scripts run with tsx). Production
#   dependencies and sources, no Next.js build; never serves traffic.
# DeckDock hub: the web image also runs the deckdock checker (`python3 -m deckdock`, vendor/deckdock)
# on uploaded decks. The library needs Python 3.13, which Debian bookworm does not package: the
# interpreter comes from the official python image (same Debian release), without pip.
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

# Python 3.13 for the deckdock checker, trimmed: no pip, ensurepip, IDLE, Tk or test modules. The
# library is compiled here: the web container's filesystem is read-only.
FROM python:3.13.17-slim-bookworm@sha256:e32be0e55814a08977501ca863271d9bd02443710db8f2afaf8372e2c4508530 AS python
RUN rm -rf /usr/local/lib/python3.13/site-packages/pip* /usr/local/lib/python3.13/ensurepip \
        /usr/local/lib/python3.13/idlelib /usr/local/lib/python3.13/tkinter \
        /usr/local/lib/python3.13/turtledemo /usr/local/lib/python3.13/test \
        /usr/local/lib/python3.13/lib-dynload/_tkinter*
COPY vendor/deckdock/deckdock /opt/deckdock/deckdock
RUN python3 -m compileall -q /opt/deckdock/deckdock

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
# The deckdock checker (README, « Écarts avec l’image du starter »): the interpreter and its standard
# library from the python stage, the library in /opt/deckdock. Both belong to root.
COPY --from=python /usr/local/bin/python3.13 /usr/local/bin/python3.13
COPY --from=python /usr/local/lib/libpython3.13.so.1.0 /usr/local/lib/libpython3.13.so.1.0
COPY --from=python /usr/local/lib/python3.13 /usr/local/lib/python3.13
COPY --from=python /opt/deckdock /opt/deckdock
ENV PYTHONPATH=/opt/deckdock PYTHONDONTWRITEBYTECODE=1 HUB_DATA_DIR=/data/hub
# Next.js writes its page cache at run time (docker-compose.prod.yml mounts both in memory).
# The hub's files (HUB_DATA_DIR): docker-compose.prod.yml mounts the hub-files volume there, and a
# new volume takes this directory's owner.
RUN ldconfig && ln -s python3.13 /usr/local/bin/python3 \
    && mkdir -p .next/cache .next/server/route-cache /data/hub \
    && chown app:app .next/cache .next/server/route-cache /data/hub
USER app
CMD ["node", "server.js"]
