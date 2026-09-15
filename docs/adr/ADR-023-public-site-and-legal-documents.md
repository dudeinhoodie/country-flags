# ADR-023: The public site, and legal documents edited in the console

- Status: Accepted
- Date: 2026-09-15

## Context

The app links to two documents it cannot ship without — the privacy policy
and the terms of use — and the release check refuses a build whose links do
not answer. Until now they were five static HTML files in `site/`, published
to GitHub Pages by a workflow and edited by pull request. That home had one
property worth keeping: it did not depend on the API being up. An App Store
reviewer, and anybody who taps the link in the app, is entitled to a page
that answers.

It had three costs. The text lived in the repository, so changing a sentence
of a policy was a commit, a review and a CI run. The pages were plain and
looked nothing like the product (ADR-012). And there was no way to tell the
site which language the reader's app was in: the app linked to the English
page, and the Russian one was a link inside it.

The product owner wants the documents off GitHub, on the project's own
infrastructure with a dev and a prod stand, edited from the admin console,
addressed by one URL per document with the app's language as a query
parameter, and shown in the app's visual language — and wants the same site
to grow a web quiz later.

## Decision

### The site is its own workspace and its own Cloud Run service

`site/` is a Yarn workspace (`@country-flags/site`): Vite, React and
TypeScript, the toolchain the console already uses, so the quiz that follows
does not rewrite the site. It is served the way the console is: a static
bundle in an nginx container on Cloud Run, `site-dev` and `site-prod` in
`europe-west3`, one immutable image promoted by digest from dev to prod
(ADR-008). The dev stand answers `X-Robots-Tag: noindex`.

Until a domain exists the addresses are the Cloud Run ones; a domain is
pointed at the services later without changing anything below.

### The documents are edited in the console and published as a snapshot

A document is a row per slug and locale in the backend's database
(`site_documents`), edited as a Markdown draft through a new admin API under
`/v1/admin/site/*` and a **Site → Documents** section of the console. The
slug is the page's address on the site (`/privacy`), shared by all of its
languages.

Publishing is a `PUBLISHER`'s act and does two things in this order: it
records an immutable, numbered version of the draft (`site_document_versions`,
with the HTML the backend rendered from the Markdown), and it writes a static
**snapshot** into the environment's site bucket — `documents/index.json`
listing every published slug and locale, and `documents/<slug>.<locale>.json`
carrying the rendered HTML. Every write is audited and carries the revision
the editor read, so a stale editor is refused rather than merged.

The site's nginx proxies `/documents/` to that bucket. The page reads the
snapshot and never the API: the property GitHub Pages had — a policy that
answers while the backend is down or asleep — survives the move. A publish is
visible within a minute (`Cache-Control: public, max-age=60` on the objects).

Rolling back is two deliberate steps: restore a version into the draft, then
publish. Unpublishing removes a locale's file and its index entry; deleting a
document is refused while it is published.

### Direct publish, not a pull request

Catalog content reaches production through a proposal, a pull request and a
publisher job (ADR-014, ADR-017) because `catalog.json` has an automated
second writer and because clients validate what they read. Neither holds for
a policy: nothing else writes it, no client parses it, and the review a legal
text needs is a person reading it, which the versions and the audit trail
give. The console publishes directly.

### Production is promoted until it has a console of its own

No `api-prod` or `admin-prod` exists yet. Until they do, the production site
serves the same files as dev: a manual workflow
(`promote-site-content-prod.yml`, gated on the `production` environment)
mirrors the `documents/` prefix from the dev bucket into the prod bucket. When
the production console exists it publishes on its own, and the promotion
workflow becomes the emergency path.

### Language is a query parameter the app sets

The app opens `/{slug}?lang=<its UI language>` — the localization its bundle
actually resolved, reduced to the language (`ru-RU` → `ru`). The site serves
that edition when it is published, English when it is not, and whatever is
published when English is not either. There is no switcher on the page and
the browser's preference is not read: the app is the one that knows what its
reader is reading in.

## Alternatives considered

- **Keep GitHub Pages and edit through pull requests.** Free and durable,
  but every wording change is a code change, and the owner's requirement is
  to manage the text from the console.
- **Render the documents from the API at request time.** The simplest
  console-to-page path, and the one that makes a shipped legal link depend on
  a scale-to-zero service being awake. Rejected for the reason the Pages
  workflow recorded.
- **Rebuild and redeploy the site image on every publish.** Fully static and
  promotable, but a wording change would wait on CI and an image push, and a
  publish would be a deploy.
- **A static bucket website behind a load balancer and CDN.** Cheaper to run
  than a container, but it needs the Compute Engine API, a load balancer and
  a certificate the project does not have yet, and the site is about to grow
  application code the bucket cannot serve.
- **A Markdown renderer in the site.** Would let the snapshot carry
  Markdown, but then two renderers — the console's preview and the site's
  page — could disagree. The backend renders once, at publish, and the
  preview is the same call.

## Consequences

- The backend grows an admin module (`admin-site`), two tables, a
  `SITE_OBJECT_STORAGE_*` configuration for the snapshot bucket and an
  optional `SITE_PUBLIC_URL` for the console's link to the page; the S3
  adapter learns `Cache-Control` and delete.
- The iOS app appends `?lang=` when it opens a document; its configured
  addresses move to the site (`Dev.xcconfig` now, `Prod.xcconfig` once
  `site-prod` serves the documents and the release check can see it).
- `site/` no longer holds the documents' text. The former pages were
  imported as the first drafts by `corepack yarn site:documents:import` from
  `backend/seed/site-documents/`, which is the seed for a fresh environment
  and not a mirror of what is published.
- The GitHub Pages workflow is gone. The last Pages publication keeps
  answering until Pages is disabled, which happens after the production
  build points at the site.
- The public site buckets are readable by anyone by design: everything in
  them is published text. Nothing private may ever be written under
  `documents/`, and the site proxies no other prefix.
- A future quiz lives in the same workspace and the same container; the
  documents remain a static snapshot beside it.

## Revisit triggers

- A domain is bought: point it at `site-prod` and `site-dev`, update the
  app's addresses and `SITE_PUBLIC_URL`.
- `admin-prod` exists: give it `SITE_OBJECT_STORAGE_*` for the prod bucket
  and demote the promotion workflow to an emergency path.
- The site needs more than static documents from the backend (a quiz with
  scores): that is an API the site calls, designed then, and it must not
  put the documents behind it.
