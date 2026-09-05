# Country Flags Admin

Internal console for managing catalog data: geo entities, subdivisions,
localized names, typed deck membership, flags and coats of arms. It is not a
general-purpose CMS and it never edits published content directly — see
`docs/adr/ADR-014-admin-console-architecture.md`.

The next multi-content/paid-deck increment is specified in
`docs/18-multi-content-paid-decks.md`. In particular, states remain shared
`GeoEntity` records with kind `SUBDIVISION`, symbols remain typed assets of an
entity, and deck membership selects `entity + templateCode + schemaVersion`.

## Commerce

The **Commerce** section (`src/resources/commerce/`) records what a paid deck
opens and which store listing sells it, following
`docs/17-paid-decks-storekit.md` §12.2 and §12.4. It has no price field and
will not get one: App Store Connect owns what a thing costs, the console
records the mapping and queues a read-only sync that a job performs with a key
this browser never holds. Every screen carries two badges — the deployment's
and the store's — because mapping a Sandbox product while looking at
production is the mistake the section exists to prevent.

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

## Deployment

`Admin CI` checks the console on every pull request that touches it — the
generated API client, formatting, lint, typecheck, unit tests, the build and
a Playwright suite that drives the **built bundle** with a stubbed admin API.
On `master` it publishes an immutable `sha-<commit>` image to GHCR; there is
no `latest`, because promotion and rollback must name an exact commit.

`Deploy admin dev` hangs off a successful Admin CI run, copies that image
into Artifact Registry, and deploys it to Cloud Run `admin-dev`. The whole
runtime configuration is set on every deploy, so what the service runs with
is readable in the workflow rather than being whatever a console session last
left on it. The deploy smoke-tests `/config.json` and, if anything fails,
routes traffic back to the previous revision.

Deploying the console and publishing content stay two separate, explicit
actions: a console deploy changes the tool, a publish run changes what every
client reads.

### One-time provisioning

Already done in `speedy-web-235610` (europe-west3):

- Cloud Run service `admin-dev` — https://admin-dev-6vgdmsupva-ey.a.run.app,
  running the placeholder image until the first real deploy replaces it;
- service account `admin-dev-runtime`, which `github-deployer` may act as;
- secret `dev-admin-email-allowlist`, readable by `api-dev-runtime`;
- bucket `country-flags-dev-drafts` with **public access prevention
  enforced**, so a draft object cannot be exposed even by mistake, plus
  HMAC credentials for `api-dev-runtime` in
  `dev-admin-draft-storage-access-key-id` / `-secret-access-key`.

What still needs a human:

- add the console's origin to the OAuth client's authorized JavaScript
  origins, beside `http://localhost:5173`;
- decide how published content becomes readable by clients — see the note
  below.

### The content bucket is private today

`country-flags-dev` has no `allUsers` binding: an anonymous request for a
published asset answers **403**, while the manifest hands clients exactly
such URLs. Dev clients therefore cannot load a flag, and that is true
independently of the console. Making the bucket publicly readable is the
obvious fix, but it is a deliberate exposure decision rather than a
detail — which is why nothing here does it silently.

The draft bucket stays separate regardless: least privilege, and a cleanup
job scoped to a different bucket cannot reach a published bundle no matter
what it is told to delete.
