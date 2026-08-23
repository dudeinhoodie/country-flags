# syntax=docker/dockerfile:1.7
# Build from the repository root:
#   docker build --file admin/Dockerfile --tag country-flags-admin:local .

FROM node:26-bookworm-slim AS dependencies

WORKDIR /workspace
# Node stopped shipping corepack with the runtime in 25, so the tool that
# reads the pinned package manager has to be fetched before it can be
# enabled (same reasoning as backend/Dockerfile).
RUN npm install --global corepack@latest && corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY admin/package.json admin/package.json
COPY backend/package.json backend/package.json
COPY contracts/package.json contracts/package.json
COPY tools/content-pipeline/package.json tools/content-pipeline/package.json
COPY backend/prisma/schema.prisma backend/prisma/schema.prisma

RUN corepack yarn install --immutable

FROM dependencies AS builder

COPY admin admin

RUN corepack yarn workspace @country-flags/admin build

FROM nginx:1.29-alpine AS runner

COPY --from=builder /workspace/admin/dist /usr/share/nginx/html
# The stock entrypoint runs envsubst over /etc/nginx/templates/*.template and
# then every /docker-entrypoint.d/*.sh, which is where the runtime config the
# SPA loads gets written. The image itself stays environment-agnostic.
COPY admin/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 admin/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh

# Cloud Run injects PORT; the default keeps local runs working.
ENV PORT=8080
EXPOSE 8080
