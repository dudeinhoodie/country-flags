# Content pipeline

Build-time TypeScript workspace for producing deterministic Country Flags
content bundles. Backend and clients consume generated files and never call
country-data providers at runtime.

The committed snapshots are a deterministic catalog described in
`docs/04-content-json-format.md`. The approved MVP selection contains all 248
current UN M49 countries/areas plus Taiwan and the editorial Kosovo entry.
Snapshots still keep only normalized fields required by the inclusion policy
instead of committing complete upstream datasets.

## Commands

Run commands from the repository root:

```bash
corepack yarn content pull --source all --update-registry
corepack yarn content pull --source world-bank --version SP.POP.TOTL-2024-snapshot-2026-07-28
corepack yarn content sync-selection
corepack yarn content build --catalog-version fixture-v1 --publish-ready
corepack yarn content validate --version fixture-v1
corepack yarn content diff --version fixture-v1 --against previous-version
corepack yarn content report --version fixture-v1
```

`build --asset-base-url https://…/` records where the manifest says the release's
assets are served from; without it the manifest keeps naming the production CDN,
as it always has. It is the bundle's own statement: a publish records the address
it actually uploaded the files to, so a release published into an environment
serves that environment's addresses whichever way the bundle was built.

`build`, `validate`, `diff`, and `report` use committed local inputs only.
Normal CI therefore has no upstream network dependency. `pull` is the only
network stage. It requires the requested revision to match the registry pin,
uses timeout/retry/backoff and a project User-Agent, and rejects changed content
before replacing the reviewed snapshot. There is no fallback to `latest`.
The isolated refresh workflow uses an explicit internal `--update-registry`
mode: an adapter must parse and normalize the payload successfully before the
workflow updates its checksum and proposes the change in a draft PR.

`pull --source all --update-registry` is the normal full refresh. It pulls UN
M49 first, synchronizes the version-controlled selection, and then refreshes
CLDR, annexare, World Bank, Wikidata, and flag-icons for all 250 approved
entities. `sync-selection` can be run separately after an editorial or UN M49
change. New politically or legally ambiguous entities still require a reviewed
editorial classification; the pipeline never accepts fuzzy or political
decisions silently.

`--publish-ready` exits non-zero for unresolved matching, unresolved
same-priority conflicts, missing required translations or flags, and asset or
license validation failures. Signing and production publication belong to issue
#5; locally generated manifests intentionally use the non-publishable
`unsigned-candidate` key ID.

## Data flow

Every source follows the same boundary:

1. `pull` obtains the pinned payload and verifies its checksum.
2. `parse` converts the provider response into its minimal snapshot shape.
3. `normalize` emits field-level patches, relations, and asset candidates.
4. Matching resolves only reliable IDs or explicit source aliases.
5. Merge applies deterministic priorities and editorial overrides.
6. Build sanitizes assets, writes stable-key JSON, records provenance, reports
   conflicts and gaps, then validates every output against JSON Schema.

Fuzzy matching only produces suggestions in
`reports/unresolved-entities.json`; it never joins records.

## Adding or refreshing a source

1. Add a unique source entry to `sources/registry.json` with an explicit
   revision, retrieval timestamp, license, snapshot path, and SHA-256. Do not
   use `latest`, a moving branch, or an unversioned package URL.
2. Add the adapter to `src/adapters.ts`. Keep provider-specific parsing there
   and emit normalized patches instead of editing `catalog.json`.
3. Store only the minimal canonical snapshot needed for an offline build.
4. Add fixture-based adapter tests. Tests must not access the network.
5. Run `pull`, inspect the checksum and license diff, then run `build`,
   `validate`, `diff`, and `report`.
6. Commit the registry, snapshot, editorial decisions, generated fixture, and
   diagnostic reports together through the source-refresh draft PR.

If an upstream payload changes at a supposedly pinned revision, `pull` reports
the observed checksum and leaves the committed snapshot untouched. A revision
or checksum is changed only in an explicit reviewed refresh.

## Resolving conflicts

Source priority is field-specific in the adapters: an editorial override wins
over a specialist source, which wins over a fallback dataset. Every
disagreement remains visible in `reports/field-conflicts.json`.

For a manual decision:

1. Verify the upstream revisions and provenance in the conflict report.
2. Add the chosen value under the entity's `overrides` in
   `editorial/catalog.json`.
3. If matching is the problem, add an explicit `<sourceKey>:<source-id>` entry
   to `sourceAliases`; never encode a fuzzy-name merge.
4. Update the editorial checksum in `sources/registry.json`.
5. Rebuild twice and confirm byte-identical output. The report should retain the
   disagreement with `resolution: editorial_override` and `blocking: false`.

Editorial files are applied after every source refresh, so reviewed decisions
survive subsequent pulls.

## Output

Bundles are written to `content/generated/<content-version>/` and contain the
manifest, catalog, typed fact collections, sanitized local SVG assets,
field-level provenance, and diagnostic reports. Population gaps are explicit
and never represented as zero. Capitals, currencies, and languages use arrays
so multiple values, roles, and validity periods can be represented.
