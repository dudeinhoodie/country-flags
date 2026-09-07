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
// content/generated/<version> through Scripts/lib/content-release.mjs, which
// the bundled catalogue is projected through as well, and --check fails when
// the committed output drifts from it.
//
//   node ios/Scripts/sync-mock-content.mjs           update the served release
//   node ios/Scripts/sync-mock-content.mjs --check   fail when it is stale (CI)

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CONTENT_VERSION,
  assetId,
  cardId,
  deckCode,
  deckId,
  deckMemberCards,
  entityId,
  factsOf,
  liveRevision,
  localizedText,
  readRelease,
  repositoryRoot,
  stableJson,
} from "./lib/content-release.mjs";

/// The locale the mock answers in. A response carries one language because the
/// transport answers per operation rather than per request, and the client's
/// own rule — the other locale becomes an alias — is reproduced below.
const PRIMARY_LOCALE = "en";
const ALIAS_LOCALE = "ru";

const outputDirectory = join(
  repositoryRoot,
  "ios/CountryFlagsKit/Sources/CountryFlagsMockBackend/Resources/MockContent",
);

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
    id: assetId(asset.key),
    type: "FLAG",
    // Contract v2: an encoding is described in `representations` and nowhere
    // else. The asset used to repeat its vector here, and the release stopped
    // publishing the fields that came from.
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

/// One fact as the contract carries it: the composed line and the parts.
///
/// Both, deliberately, the way `mapBackSideFacts` sends both — the line keeps
/// an older client whole while the parts let the screen word the fact itself.
/// The publisher never records an observation day, only when the value was
/// retrieved, so the card reports none; for a population the year is part of
/// the parts instead.
function servedFact({ type, displayValue, details, source }) {
  return {
    type,
    displayValue,
    ...(details === null ? {} : { details }),
    observedAt: null,
    source,
  };
}

function buildCard({ card, entity, asset, assetBaseUrl, template, facts }) {
  const revision = liveRevision(card);
  const primary = localizedText(entity.names, PRIMARY_LOCALE, PRIMARY_LOCALE);
  const alias = localizedText(entity.names, ALIAS_LOCALE, PRIMARY_LOCALE);

  return {
    id: cardId(card),
    templateCode: card.templateCode,
    templateSchemaVersion: card.templateSchemaVersion,
    semanticVersion: card.semanticVersion,
    revision: revision.revision,
    answerMode: template.gradingMode.toUpperCase(),
    prompt: { asset: buildAsset(asset, assetBaseUrl) },
    answer: {
      entityId: entityId(entity.key),
      displayName: primary.short,
      // The read path treats every other name the release carries for the
      // entity as an alias, which is what lets a quiz accept either language.
      aliases: alias.short === primary.short ? [] : [alias.short],
    },
    backSideFacts: facts.map(servedFact),
    contentVersion: CONTENT_VERSION,
  };
}

function page(items) {
  return { items, page: { nextCursor: null, hasMore: false } };
}

async function buildDocuments() {
  const release = await readRelease();
  const { manifest, catalog, entities, assets, templates, cardsByVariant } =
    release;
  const assetBaseUrl = manifest.assetBaseUrl;

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
    const cards = deckMemberCards(deck, cardsByVariant).map((card) => {
      const entity = entities.get(card.entityKey);
      const asset = assets.get(liveRevision(card).promptAssetKey);
      if (entity === undefined || asset === undefined) {
        throw new Error(
          `${card.entityKey} refers to content the release does not publish`,
        );
      }
      return buildCard({
        card,
        entity,
        asset,
        assetBaseUrl,
        template: templates.get(card.templateCode),
        facts: factsOf(release.factsByEntity, card.entityKey, PRIMARY_LOCALE),
      });
    });

    const names = localizedText(deck.names, PRIMARY_LOCALE, PRIMARY_LOCALE);
    decks.push({
      id: deckId(deck.key),
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
  const committed = new Set(await readdir(outputDirectory).catch(() => []));
  const stale = [];
  for (const [name, document] of documents) {
    const current = await readFile(join(outputDirectory, name), "utf8").catch(
      () => "",
    );
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
  const leftOver = new Set(await readdir(outputDirectory).catch(() => []));
  for (const [name, document] of documents) {
    await writeFile(join(outputDirectory, name), stableJson(document));
    leftOver.delete(name);
  }
  // Whatever the projection no longer produces goes, because the check above
  // refuses it. A deck the editorial change removed left its file behind, and
  // the only advice the failure could give — run this script and commit the
  // result — changed nothing, so a content proposal could not be made green
  // by anything short of deleting the file by hand.
  //
  // This directory holds the projection and nothing else, which is what lets
  // the sweep be this blunt: the check already treats every file in it that
  // is not generated as an error.
  for (const name of leftOver) {
    await rm(join(outputDirectory, name));
  }
  process.stdout.write(
    `Projected ${CONTENT_VERSION} into ${String(documents.size)} mock documents` +
      (leftOver.size === 0
        ? ".\n"
        : `, and removed ${String(leftOver.size)} the release no longer has.\n`),
  );
}
