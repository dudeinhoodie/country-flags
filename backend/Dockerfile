# syntax=docker/dockerfile:1.7

FROM node:26-bookworm-slim AS base

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

WORKDIR /workspace
# Node stopped shipping corepack with the runtime in 25, so the tool that
# reads the pinned package manager has to be fetched before it can be
# enabled. Everything below still goes through it, which is what keeps the
# image building with the same yarn the lockfile was written by.
RUN npm install --global corepack@latest && corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY admin/package.json admin/package.json
COPY backend/package.json backend/package.json
COPY contracts/package.json contracts/package.json
COPY tools/asset-core/package.json tools/asset-core/package.json
COPY tools/content-pipeline/package.json tools/content-pipeline/package.json
COPY backend/prisma/schema.prisma backend/prisma/schema.prisma

RUN corepack yarn install --immutable

FROM dependencies AS builder

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public

COPY backend backend
COPY contracts contracts
# The shared asset core is a workspace dependency of the runtime, so its
# compiled output has to exist in the image, not only on a developer machine.
COPY tools/asset-core tools/asset-core
# The publisher job builds the release it is about to sign, from the catalog
# this image carries, with the very command CI builds the committed fixture
# with (ADR-017 §1). It is the same image the API runs, started differently:
# the pipeline's only runtime dependencies — ajv, ajv-formats and the asset
# core's resvg — are already the backend's, so carrying it costs the compiled
# output and two megabytes of source snapshots and not one extra package.
COPY tools/content-pipeline tools/content-pipeline

RUN corepack yarn workspace @country-flags/asset-core build

RUN corepack yarn prisma:generate
RUN corepack yarn workspace @country-flags/backend build
RUN corepack yarn workspace @country-flags/content-pipeline build
RUN corepack yarn workspaces focus \
  @country-flags/backend @country-flags/content-pipeline --production

FROM base AS runner

# The base Node image bundles a global npm the runtime never invokes (CMD is a
# plain `node` call) — strip it so its own transitive dependencies (e.g. tar,
# brace-expansion) can't show up as image CVEs that have nothing to do with
# this application's actual dependency tree. The corepack paths are listed too
# and are simply absent since Node 25 stopped bundling it; naming them costs
# nothing and keeps this working if a base image carries it again.
RUN rm -rf \
  /usr/local/lib/node_modules/npm \
  /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/corepack

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /workspace/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/backend/package.json ./backend/package.json
COPY --from=builder --chown=node:node /workspace/backend/dist ./backend/dist
COPY --from=builder --chown=node:node /workspace/backend/prisma ./backend/prisma
# node_modules links the workspace by relative path, so the package has to
# sit where that link points.
COPY --from=builder --chown=node:node /workspace/tools/asset-core/package.json ./tools/asset-core/package.json
COPY --from=builder --chown=node:node /workspace/tools/asset-core/dist ./tools/asset-core/dist
# The publisher job's half of the image. The pipeline resolves its own root
# from where its entry point sits, so the package has to keep the layout it
# has in the repository: `dist` beside `sources` and `editorial`, two levels
# below the tree that holds `content/schemas` and `contracts/`.
COPY --from=builder --chown=node:node /workspace/tools/content-pipeline/package.json ./tools/content-pipeline/package.json
COPY --from=builder --chown=node:node /workspace/tools/content-pipeline/dist ./tools/content-pipeline/dist
COPY --chown=node:node tools/content-pipeline/sources ./tools/content-pipeline/sources
COPY --chown=node:node tools/content-pipeline/editorial ./tools/content-pipeline/editorial
# The schemas a publish-ready build validates its own output against. Without
# them the build fails at the last step, after twelve minutes of rasterising.
COPY --chown=node:node content/schemas ./content/schemas
# The admin console imports drafts from the editorial catalog, and the
# runtime has no git checkout: the catalog and its schema ride in the image,
# belonging to exactly the commit this image was built from (SERVICE_RELEASE).
COPY --chown=node:node tools/content-pipeline/editorial/catalog.json ./editorial/catalog.json
COPY --chown=node:node contracts/schemas/content/editorial-catalog.v2.schema.json ./contracts/editorial-catalog.v2.schema.json
COPY --chown=node:node contracts/schemas/content/editorial-catalog.v3.schema.json ./contracts/editorial-catalog.v3.schema.json
ENV ADMIN_CATALOG_PATH=/app/editorial/catalog.json
ENV ADMIN_EDITORIAL_SCHEMA_PATH=/app/contracts/editorial-catalog.v2.schema.json
ENV ADMIN_EDITORIAL_SCHEMA_V3_PATH=/app/contracts/editorial-catalog.v3.schema.json
COPY --from=builder --chown=node:node /workspace/contracts ./contracts

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "backend/dist/main.js"]
