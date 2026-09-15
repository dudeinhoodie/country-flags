# syntax=docker/dockerfile:1.7
# Build from the repository root:
#   docker build --file site/Dockerfile --tag country-flags-site:local .

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
COPY site/package.json site/package.json
COPY tools/asset-core/package.json tools/asset-core/package.json
COPY tools/content-pipeline/package.json tools/content-pipeline/package.json
COPY backend/prisma/schema.prisma backend/prisma/schema.prisma

RUN corepack yarn install --immutable

FROM dependencies AS builder

COPY site site

RUN corepack yarn workspace @country-flags/site build

FROM nginx:1.29-alpine AS runner

# Only the built bundle: the fixtures the dev server answers with live
# outside public/ and never reach the image.
COPY --from=builder /workspace/site/dist /usr/share/nginx/html
# The stock entrypoint sources /docker-entrypoint.d/*.envsh, runs envsubst
# over /etc/nginx/templates/*.template and then every *.sh, in name order.
# The robots tag is derived first, the template reads it, and the runtime
# config the page loads is written last. The image itself carries no
# environment, bucket address or version.
COPY site/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 site/docker/10-site-robots.envsh /docker-entrypoint.d/10-site-robots.envsh
COPY --chmod=0755 site/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh

# Cloud Run injects PORT; the default keeps local runs working.
ENV PORT=8080
EXPOSE 8080
