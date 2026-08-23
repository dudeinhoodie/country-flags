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
COPY tools/content-pipeline/package.json tools/content-pipeline/package.json
COPY backend/prisma/schema.prisma backend/prisma/schema.prisma

RUN corepack yarn install --immutable

FROM dependencies AS builder

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public

COPY backend backend
COPY contracts contracts

RUN corepack yarn prisma:generate
RUN corepack yarn workspace @country-flags/backend build
RUN corepack yarn workspaces focus @country-flags/backend --production

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
COPY --from=builder --chown=node:node /workspace/contracts ./contracts

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "backend/dist/main.js"]
