# syntax=docker/dockerfile:1
#
# AFC Church Portal — apps/web image.
#
# Multi-stage so the runtime layer carries no toolchain and no devDependencies.
# This repository holds children's records: the image that serves the portal
# should not contain the compiler, the linter or the test harness.
#
# Build from the workspace root, not from apps/web, because `pnpm --filter web`
# needs pnpm-workspace.yaml, the root lockfile and packages/shared:
#
#   docker build -f apps/web/Dockerfile -t afc-church-portal-web .

# --------------------------------------------------------------------------
# deps: resolve the workspace and produce node_modules
# --------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /repo

# The manifests are copied before the sources so that a source-only change does
# not invalidate the install layer. pnpm needs to see every workspace package's
# manifest, or it resolves a partial tree.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter web... --filter @afc/shared...

# --------------------------------------------------------------------------
# build: produce .output
# --------------------------------------------------------------------------
FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-workspace.yaml ./
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared

# Nitro needs the whole workspace at build time: the Nuxt config, the shared
# package, and the lockfile-derived node_modules from the previous stage.
RUN pnpm --filter web build

# --------------------------------------------------------------------------
# runtime: the server bundle only
# --------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

WORKDIR /app

COPY --from=build /repo/apps/web/.output ./.output

# `node` (uid 1000) ships with the base image. The portal writes nothing to disk,
# so the filesystem can stay read-only apart from /tmp.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]