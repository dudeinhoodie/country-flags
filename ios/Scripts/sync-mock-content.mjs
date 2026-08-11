// Projects one content release into the API documents the Mock build serves.
//
// The Mock scheme is the only configuration of this app that runs without a
// backend, so it decides what the app looks like to anyone who launches it. It
// used to answer with six flags written out as lists of colours, which meant
// no screen ever showed the product and the flags bundled by ADR-011 could not
// be drawn at all: their checksums are the release's, and the mock's were
// computed from its own bytes.
//
// This script performs the projection the backend performs at publish time —
// documents keyed by content key become API responses keyed by UUID — so the
// mock serves the real release without a database. It is a projection, not a
// second source of truth: everything here is derived from
// content/generated/<version>, and --check fails when the committed output
// drifts from it.
//
//   node ios/Scripts/sync-mock-content.mjs           update the served release
//   node ios/Scripts/sync-mock-content.mjs --check   fail when it is stale (CI)

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/// The release the Mock build serves. The same one the app bundles its flags
/// from, which is what makes every flag resolve out of the bundle and the run
/// need no network at all.
const CONTENT_VERSION = "fixture-v1";

/// The locale the mock answers in. A response carries one language because the
/// transport answers per operation rather than per request, and the client's
/// own rule — the other locale becomes an alias — is reproduced below.
const PRIMARY_LOCALE = "en";
const ALIAS_LOCALE = "ru";

const bundleDirectory = join(repositoryRoot, "content/generated", CONTENT_VERSION);
const outputDirectory = join(
  repositoryRoot,
  "ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/Resources/MockContent",
);

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readDocument(path) {
  return JSON.parse(await readFile(join(bundleDirectory, path), "utf8"));
}

/// The backend allocates content identifiers in its database, so nothing maps a
/// content key to a UUID outside one deployment. The mock derives them instead,
/// by the same construction the publisher uses for source rows
/// (backend/src/modules/content/bundle/bundle-mapper.ts), so a rebuild of this
/// file does not invalidate what a previous run stored on a device.
function deterministicUuid(seed) {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/// A deck is published under its content key, and the contract requires a code
/// of `^[A-Z][A-Z0-9_]*$`, so `deck.europe` is served as `EUROPE`.
function deckCode(key) {
  return key
    .replace(/^deck\./u, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "_");
}

function localizedName(names, locale) {
  return names[locale] ?? names[PRIMARY_LOCALE] ?? Object.values(names)[0];
}

function buildManifest(manifest) {
  const { $schema, ...served } = manifest;
  return {
    ...served,
    // The release requires a client this app does not claim to be yet, and a
    // build that told itself to update would exercise nothing but the update
    // screen.
    minimumClientVersion: "0.0.0",
  };
}

function buildAsset(asset, assetBaseUrl) {
  return {
    id: deterministicUuid(`content-asset:${asset.key}`),
    type: "FLAG",
    url: `${assetBaseUrl}${asset.path}`,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    representations: asset.representations.map((representation) => ({
      url: `${assetBaseUrl}${representation.path}`,
      mimeType: representation.mimeType,
      sha256: representation.sha256,
      scale: representation.scale ?? null,
      widthPx: representation.widthPx ?? null,
      heightPx: representation.heightPx ?? null,
    })),
    // The publisher never records pixel dimensions on the asset itself; they
    // belong to a representation, and a vector original has none.
    width: null,
    height: null,
    aspectRatio: asset.aspectRatio ?? null,
    licenseName: asset.license,
    attribution: asset.attribution ?? null,
  };
}

function buildCard({ card, entity, asset, assetBaseUrl, template }) {
  // The revision a client is served is the live one; a retired revision is
  // history the change feed carries rather than something to study.
  const revision = card.revisions
    .filter(({ retiredAt }) => retiredAt === null)
    .sort((left, right) => right.revision - left.revision)[0];
  const primary = localizedName(entity.names, PRIMARY_LOCALE);
  const alias = localizedName(entity.names, ALIAS_LOCALE);

  return {
    id: deterministicUuid(`content-card:${card.entityKey}:${card.semanticVersion}`),
    templateCode: card.templateCode,
    templateSchemaVersion: card.templateSchemaVersion,
    semanticVersion: card.semanticVersion,
    revision: revision.revision,
    answerMode: template.gradingMode.toUpperCase(),
    prompt: { asset: buildAsset(asset, assetBaseUrl) },
    answer: {
      entityId: deterministicUuid(`content-entity:${entity.key}`),
      displayName: primary.short,
      // The read path treats every other name the release carries for the
      // entity as an alias, which is what lets a quiz accept either language.
      aliases: alias.short === primary.short ? [] : [alias.short],
    },
    // The release publishes facts, but their values carry no display form, so
    // a real response would put JSON on the back of a card. Left empty until
    // the backend formats them.
    backSideFacts: [],
    contentVersion: CONTENT_VERSION,
  };
}

function page(items) {
  return { items, page: { nextCursor: null, hasMore: false } };
}

async function buildDocuments() {
  const [manifest, catalog, learningCards, cardTemplates, assetRegistry] =
    await Promise.all([
      readDocument("manifest.json"),
      readDocument("catalog.json"),
      readDocument("learning-cards.json"),
      readDocument("card-templates.json"),
      readDocument("assets/assets.json"),
    ]);

  const assetBaseUrl = manifest.assetBaseUrl;
  const entities = new Map(catalog.entities.map((entity) => [entity.key, entity]));
  const assets = new Map(assetRegistry.assets.map((asset) => [asset.key, asset]));
  const templates = new Map(
    cardTemplates.templates.map((template) => [template.code, template]),
  );
  const cardsByEntity = new Map(
    learningCards.cards
      .filter(({ status }) => status === "active")
      .map((card) => [card.entityKey, card]),
  );

  const documents = new Map();
  documents.set("manifest.json", buildManifest(manifest));
  documents.set("changes.json", {
    // The mock release never changes under the app, so a refresh is a no-op
    // rather than a second bootstrap.
    items: [],
    nextCursor: manifest.changeCursor,
    hasMore: false,
    contentVersion: CONTENT_VERSION,
  });

  const decks = [];
  for (const deck of catalog.decks) {
    const code = deckCode(deck.key);
    // The deck declares its members in a fixed order, and that order is what a
    // learner walks the deck in.
    const cards = deck.memberEntityKeys
      .map((entityKey) => cardsByEntity.get(entityKey))
      .filter((card) => card !== undefined)
      .map((card) => {
        const entity = entities.get(card.entityKey);
        const revision = card.revisions.find(({ retiredAt }) => retiredAt === null);
        const asset = assets.get(revision.promptAssetKey);
        if (entity === undefined || asset === undefined) {
          throw new Error(`${card.entityKey} refers to content the release does not publish`);
        }
        return buildCard({
          card,
          entity,
          asset,
          assetBaseUrl,
          template: templates.get(card.templateCode),
        });
      });

    const names = localizedName(deck.names, PRIMARY_LOCALE);
    decks.push({
      id: deterministicUuid(`content-deck:${deck.key}`),
      code,
      kind: deck.kind.toUpperCase(),
      name: names.name,
      description: names.description,
      cardCount: cards.length,
      dueCount: null,
      contentVersion: CONTENT_VERSION,
    });
    documents.set(`deck-cards-${code}.json`, page(cards));
  }

  documents.set("decks.json", page(decks));
  return documents;
}

const checkOnly = process.argv.includes("--check");
const documents = await buildDocuments();

if (checkOnly) {
  const committed = new Set(
    await readdir(outputDirectory).catch(() => []),
  );
  const stale = [];
  for (const [name, document] of documents) {
    const current = await readFile(join(outputDirectory, name), "utf8").catch(() => "");
    if (current !== stableJson(document)) {
      stale.push(name);
    }
    committed.delete(name);
  }
  const orphaned = [...committed];
  if (stale.length > 0 || orphaned.length > 0) {
    process.stderr.write(
      `::error::The mock content is stale (${[...stale, ...orphaned.map((name) => `${name} is no longer generated`)].join(", ")}). Run ios/Scripts/sync-mock-content.mjs and commit the result.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`The mock content matches ${CONTENT_VERSION}.\n`);
  }
} else {
  await mkdir(outputDirectory, { recursive: true });
  for (const [name, document] of documents) {
    await writeFile(join(outputDirectory, name), stableJson(document));
  }
  process.stdout.write(
    `Projected ${CONTENT_VERSION} into ${String(documents.size)} mock documents.\n`,
  );
}
