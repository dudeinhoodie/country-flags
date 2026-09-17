# Vexi site

The public website of Vexi: today the legal documents the iOS app
links to (privacy policy, terms of use), later the web quiz. One Vite + React
page in the app's own visual language — the dark scene, glass panels and
capsules of ADR-012 — and nothing else: no external fonts, no analytics, no
cookies, no third-party scripts.

It replaces the static pages that used to be published to GitHub Pages out of
this directory. The documents are no longer files in the repository: they are
edited in the admin console (Site → Documents) and published as a snapshot
into a bucket the site reads. The decision and its reasons are in
`docs/adr/ADR-023-public-site-and-legal-documents.md`.

## Where the documents come from

The page never talks to the API. The console publishes each document as a
JSON file into the environment's bucket (`country-flags-site-dev`,
`country-flags-site-prod`), and nginx proxies that bucket same-origin under
`/documents/`, so a policy answers whether or not the backend is up — which
is the point of a privacy policy a shipped app links to.

```
GET /documents/index.json
{ "generatedAt": "2026-09-15T10:00:00Z",
  "documents": [
    { "slug": "privacy", "locale": "en", "title": "Privacy Policy",
      "version": 3, "publishedAt": "2026-09-15T10:00:00Z" },
    …
  ] }

GET /documents/{slug}.{locale}.json
{ "slug": "privacy", "locale": "en", "title": "Privacy Policy",
  "version": 3, "publishedAt": "2026-09-15T10:00:00Z",
  "html": "<p>…</p><h2>…</h2>…" }
```

`html` is rendered by the backend from Markdown with raw HTML disabled:
headings, paragraphs, lists, links, emphasis, blockquotes, rules, code and
tables. A missing file answers 404 (the bucket's XML body is ignored). A
missing index means nothing is published yet, which the page shows as such
rather than as an error.

## The icon in the tab

`public/` carries the favicon set: `favicon.ico` (16, 32 and 48 px inside),
`favicon-32x32.png`, `apple-touch-icon.png` (180 px) and the 192 and 512 px
PNGs that `manifest.json` names. All of them are the app icon
(`ios/CountryFlagsApp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`)
cut down by hand by the owner; there is no script, and no vector, because the
app icon itself is a raster (`design/app-icon/README.md`). When the app icon
changes, the set is regenerated from the new 1024 px PNG and replaced here.

## Addresses and language

- `/` — what the app is, the published documents, support and attribution.
- `/{slug}` — one document, e.g. `/privacy`, `/terms`. Anything unpublished
  is a "no such document" card with a way home.

The language comes from one place: the `lang` query parameter the iOS app
appends when it opens a document (`/privacy?lang=ru`). There is no switcher
on the page and the browser's own preference is not read. `ru-RU`, `ru_RU`
and `RU` all mean `ru`; anything that is not a language means `en`. A
document is served in the requested language when that edition is
published, in English when it is not, and in whatever is published when
English is not either; `<html lang>` follows the edition actually shown.
Every link on the page forwards the parameter as it arrived.

## Runtime configuration

The image is environment-agnostic. At startup the container writes
`/config.json`:

```json
{ "environment": "dev", "appVersion": "<git sha or image digest>" }
```

The page refuses to render anything but an error if the file is missing or
invalid, and shows a quiet "dev stand" tag in the footer for anything but
`prod`. `public/config.json` is the local mock.

Container variables (all set by the deploy workflows):

| Variable | Meaning |
| --- | --- |
| `SITE_ENVIRONMENT` | `local`, `dev` or `prod`. Also decides `X-Robots-Tag`: `all` in prod, `noindex, nofollow` elsewhere. |
| `SITE_DOCUMENTS_UPSTREAM` | Bucket origin and prefix, no trailing slash, e.g. `https://storage.googleapis.com/country-flags-site-dev/documents`. |
| `SITE_APP_VERSION` | Written into `config.json`; the commit in dev, the image digest in prod. |
| `PORT` | Injected by Cloud Run; defaults to 8080. |

`docker/10-site-robots.envsh` checks the variables and derives the robots
tag before nginx substitutes `nginx.conf.template`; `docker/40-runtime-config.sh`
writes the config file. `/healthz` answers `ok`.

## Commands

Run from the repository root:

```bash
corepack yarn web:dev      # Vite dev server; /documents/* answered from fixtures/documents
corepack yarn web:build    # production build into web/dist
corepack yarn web:test     # Vitest unit tests
corepack yarn workspace @country-flags/web lint
corepack yarn workspace @country-flags/web typecheck
corepack yarn workspace @country-flags/web preview   # the built bundle, with the same fixtures
```

`fixtures/documents/` holds a sample snapshot for local work. It is served
only by the dev and preview servers (see `vite.config.ts`) and never reaches
the image. To read a real bucket instead, point the dev server at it:

```bash
SITE_DOCUMENTS_PROXY=https://storage.googleapis.com/country-flags-site-dev/documents corepack yarn web:dev
```

## Deployment

- `site-ci.yml` checks the workspace on every pull request that touches it
  and, on `master`, publishes `ghcr.io/dudeinhoodie/country-flags-site:sha-<commit>`.
- `deploy-site-dev.yml` follows a green Site CI run on `master`: copies the
  image into Artifact Registry, deploys `site-dev` (creating it on the first
  run), smoke-tests `/config.json`, `/` and `/documents/index.json`, and
  rolls back if any of them fails.
- `deploy-site-prod.yml` is manual and gated by the `production` GitHub
  environment. It promotes the digest `site-dev` is serving — never a
  rebuild — to `site-prod`. `--min-instances` stays at 0 until the app is
  on the store.
- The documents are promoted separately: publishing in the console writes
  the dev bucket, and `promote-site-content-prod.yml` copies the snapshot
  into the prod bucket behind the same approval gate.

Both services run as their own identities (`site-dev-runtime`,
`site-prod-runtime`) with no permissions at all: the page reads a public
bucket and holds nothing worth stealing. Provisioning is documented in
`docs/13-deployment-environments.md` §6.4.
