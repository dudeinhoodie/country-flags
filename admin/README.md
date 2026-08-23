# Country Flags Admin

Internal console for managing catalog data: decks, localized names, deck
membership, flags and future coats of arms. It is not a general-purpose CMS
and it never edits published content directly — see
`docs/adr/ADR-014-admin-console-architecture.md`.

## Commands

Run from the repository root:

```bash
corepack yarn admin:dev      # Vite dev server with the mock config in public/config.json
corepack yarn admin:build    # production build into admin/dist
corepack yarn admin:test     # Vitest unit tests
corepack yarn admin:api:generate  # regenerate src/api/generated from the admin contract
corepack yarn admin:api:check     # fail when the generated API surface drifted
corepack yarn workspace @country-flags/admin lint
corepack yarn workspace @country-flags/admin typecheck
```

The typed API client (`src/api/client.ts`) is generated from the separate
admin contract root `contracts/admin-openapi.yaml` (see the "Admin contract
root" section of `contracts/README.md`); the generated file under
`src/api/generated/` is committed and checked for drift in CI.

The root `build`, `format`, `format:check`, `lint`, `typecheck`, `test` and
`test:ci` scripts include this workspace, so backend CI checks it on every
pull request.

## Runtime configuration

The SPA is environment-agnostic. At startup it fetches `/config.json` and
refuses to render anything but a blocking error screen if the file is
missing or invalid:

```json
{
  "environment": "dev",
  "apiBasePath": "/api",
  "googleClientId": "public-client-id",
  "appVersion": "git-sha"
}
```

- `environment` — `local`, `dev` or `prod`; drives the always-visible
  environment badge, and prod additionally gets a red app bar;
- `apiBasePath` — always `/api`; the container proxies it to the backend so
  the browser stays same-origin;
- `googleClientId` — public identifier, empty until the sign-in flow lands;
- `appVersion` — the deployed commit, stamped at deploy time.

During local development Vite serves the mock config from
`public/config.json`; no backend is required.

To develop against a real backend (for example the dev contour), point the
dev server's `/api` proxy at its origin and supply the console's Google
client id:

```bash
ADMIN_DEV_PROXY=https://<backend-dev>.run.app \
ADMIN_DEV_GOOGLE_CLIENT_ID=<public-client-id> \
ADMIN_DEV_ENVIRONMENT=dev \
corepack yarn admin:dev
```

Open http://localhost:5173 (the hostname matters: browsers accept the
backend's Secure session cookie on `localhost`, not on `127.0.0.1`). The
backend must list `http://localhost:5173` in `ADMIN_ALLOWED_ORIGINS` and
your email in `ADMIN_EMAIL_ALLOWLIST`.

## Container

`admin/Dockerfile` builds the SPA and serves it with nginx. The stock nginx
entrypoint renders `nginx.conf.template` and runs
`docker/40-runtime-config.sh`, which writes `/config.json` from:

| Variable | Required | Meaning |
| --- | --- | --- |
| `ADMIN_ENVIRONMENT` | yes | `local`, `dev` or `prod` |
| `ADMIN_API_UPSTREAM` | yes | backend origin without a trailing slash |
| `ADMIN_APP_VERSION` | no | deployed commit, defaults to `unknown` |
| `ADMIN_GOOGLE_CLIENT_ID` | no | public Google client id |

`/api/*` is proxied to `ADMIN_API_UPSTREAM` with the `/api` prefix stripped:
`/api/v1/admin/me` reaches the backend as `/v1/admin/me`. Secrets never
appear in the Vite bundle, `config.json` or this image.
