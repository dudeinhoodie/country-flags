# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

WORKDIR /workspace
RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY backend/package.json backend/package.json
COPY contracts/package.json contracts/package.json
COPY backend/prisma/schema.prisma backend/prisma/schema.prisma

RUN corepack yarn install --immutable

FROM dependencies AS builder

ENV DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public

COPY backend backend

RUN corepack yarn prisma:generate
RUN corepack yarn build
RUN corepack yarn workspaces focus @country-flags/backend --production

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /workspace/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/backend/package.json ./backend/package.json
COPY --from=builder --chown=node:node /workspace/backend/dist ./backend/dist
COPY --from=builder --chown=node:node /workspace/backend/prisma ./backend/prisma

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health/live').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "backend/dist/main.js"]
