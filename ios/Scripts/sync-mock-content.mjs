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
const CONTENT_VERSION = "fixture-v3";

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

function buildCard({ card, entity, asset, assetBaseUrl, template, facts }) {
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
    backSideFacts: facts,
    contentVersion: CONTENT_VERSION,
  };
}

/// The sources the pipeline names, as the publisher records them
/// (backend/src/modules/content/bundle/bundle-mapper.ts). A key with no entry
/// falls back the same way the publisher's does.
const SOURCES = {
  annexare: { name: "annexare/Countries", url: "https://github.com/annexare/Countries" },
  cldr: { name: "Unicode CLDR", url: "https://github.com/unicode-org/cldr-json" },
  "world-bank": { name: "World Bank Open Data", url: "https://data.worldbank.org/" },
  wikidata: { name: "Wikidata", url: "https://www.wikidata.org/" },
  "flag-icons": { name: "lipis/flag-icons", url: "https://github.com/lipis/flag-icons" },
  editorial: {
    name: "Country Flags editorial overrides",
    url: "https://country-flags.app/content/editorial",
  },
};

const FACT_TYPES = {
  capitals: "CAPITAL",
  currencies: "CURRENCY",
  languages: "LANGUAGE",
  population: "POPULATION",
};

const languageNames = new Intl.DisplayNames([PRIMARY_LOCALE], {
  type: "language",
  fallback: "none",
});

/// The same rendering the API performs on read
/// (backend/src/modules/content/fact-display.ts). A value whose shape is not
/// recognised yields null and the fact is left out, because a card that
/// reported its own JSON is the defect this exists to end.
function factDisplayValue(factType, value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.displayValue === "string" && value.displayValue.length > 0) {
      return value.displayValue;
    }
  }
  const entries = Array.isArray(value) ? value : [];
  const join = (values) => (values.length > 0 ? values.join(", ") : null);

  switch (factType) {
    case "CAPITAL":
      return join(
        entries
          .filter((seat) => seat.role === undefined || seat.role === "official")
          .map((seat) => seat.name)
          .filter((name) => typeof name === "string"),
      );
    case "POPULATION": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) return null;
      const formatted = new Intl.NumberFormat(PRIMARY_LOCALE).format(value.value);
      return typeof value.year === "number" ? `${formatted} (${String(value.year)})` : formatted;
    }
    case "CURRENCY":
      return join(
        entries
          .filter((entry) => entry.role === undefined || entry.role === "legal_tender")
          .map((entry) => {
            if (typeof entry.code !== "string") return null;
            const name = entry.names?.[PRIMARY_LOCALE];
            return typeof name === "string" && name.length > 0
              ? `${name} (${entry.code})`
              : entry.code;
          })
          .filter((entry) => entry !== null),
      );
    case "LANGUAGE":
      return join(
        entries
          .map((entry) => entry.code)
          .filter((code) => typeof code === "string")
          .map((code) => {
            try {
              return languageNames.of(code) ?? null;
            } catch {
              return null;
            }
          })
          .filter((name) => name !== null),
      );
    default:
      return null;
  }
}

/// The facts of one entity, ordered by type as the API orders them.
function backSideFacts(factsByEntity, entityKey) {
  return (factsByEntity.get(entityKey) ?? [])
    .map(({ factType, record }) => {
      const displayValue = factDisplayValue(factType, record.value);
      if (displayValue === null) return null;
      const source = SOURCES[record.provenance?.sourceKey] ?? {
        name: record.provenance?.sourceKey ?? "unknown",
        url: `https://country-flags.app/content-sources/${record.provenance?.sourceKey ?? "unknown"}`,
      };
      return {
        _type: factType,
        displayValue,
        // The publisher never records an observation day, only when the value
        // was retrieved, so the card reports none. For a population the year
        // is part of the sentence instead.
        observedAt: null,
        source,
      };
    })
    .filter((fact) => fact !== null)
    .sort((left, right) => left._type.localeCompare(right._type, "en"))
    .map(({ _type, ...fact }) => ({ type: _type, ...fact }));
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

  // The facts the release publishes about each entity, which is what the back
  // of a card is made of. A record marked as a gap has no value to show.
  const factsByEntity = new Map();
  for (const [file, factType] of Object.entries(FACT_TYPES)) {
    const collection = await readDocument(`facts/${file}.json`);
    for (const record of collection.records) {
      if (record.gap === true) continue;
      const existing = factsByEntity.get(record.entityKey) ?? [];
      existing.push({ factType, record });
      factsByEntity.set(record.entityKey, existing);
    }
  }

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
          facts: backSideFacts(factsByEntity, card.entityKey),
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
