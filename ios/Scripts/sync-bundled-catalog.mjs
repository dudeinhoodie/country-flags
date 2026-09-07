// Projects one content release into the catalogue the app opens on.
//
// ADR-011 put the drawings of a pinned release inside the binary. The
// catalogue they belong to was still downloaded, so a first launch with no
// network sat on the launch screen until the request timed out and then said
// "you are offline" over three empty tabs — with 250 flags sitting unused in
// the bundle (#301). This writes the missing half: the decks, cards, entities
// and assets of the same release, as one document the app seeds an empty store
// from before it touches the network. See
// docs/adr/ADR-021-bundled-catalogue-snapshot.md.
//
// What it carries is what an unauthenticated caller would be served, and that
// is not a rule invented here: a deck is public when
// `DeckAccessService.isGranted(deck, null)` says so, and everything else is
// classified by the reach rules in `ContentAccessProjectionService`. A deck
// somebody has to buy contributes its metadata and its published preview, and
// its cards stay on the server where the entitlement guard is.
//
//   node ios/Scripts/sync-bundled-catalog.mjs           update the snapshot
//   node ios/Scripts/sync-bundled-catalog.mjs --check   fail when it is stale
//
// The output is generated, never edited: --check runs in CI so a build cannot
// ship a catalogue no release ever published.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CONTENT_VERSION,
  bundleDirectory,
  assetId,
  cardId,
  deckAccess,
  deckCode,
  deckId,
  deckMemberCards,
  entityId,
  factsOf,
  isGrantedToAnonymous,
  isPubliclyVisible,
  liveRevision,
  localizedName,
  mapAssetType,
  mapEntityKind,
  mapEntityStatus,
  readRelease,
  repositoryRoot,
  stableJson,
  visibilityOf,
} from "./lib/content-release.mjs";

/// The version the seeded release is stored under.
///
/// Deliberately not the release's own version, and this is the load-bearing
/// detail of the whole design. The backend allocates content identifiers in
/// its database, so the identifiers derived here are not the ones a server
/// hands out for the same cards. Were the snapshot stored under the release's
/// version and the server then served that same release, both sets of rows
/// would answer every read at once and the catalogue would show every deck
/// twice.
///
/// Under a version of its own the seeded release is superseded whole the first
/// time a real one is committed: every listing reads from the release the
/// current manifest names, so the bundled rows stop being visible the moment
/// the server's release lands. The bundle is a baseline, never the truth.
const BUNDLED_CONTENT_VERSION = `bundled:${CONTENT_VERSION}`;

const outputPath = join(
  repositoryRoot,
  "ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/Resources/BundledCatalog.json",
);

/// The locale candidates the backend resolves a name through
/// (backend/src/modules/content/content-query.ts).
function localeCandidates(locale, defaultLocale) {
  const normalized = locale.toLowerCase();
  return [normalized, normalized.split("-")[0], defaultLocale.toLowerCase()]
    .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index);
}

/// Every name the release publishes for an entity, as the rows the backend
/// stores: one per locale and name type.
function entityNameRows(entity) {
  const rows = [];
  for (const [locale, names] of Object.entries(entity.names)) {
    if (typeof names.short === "string") {
      rows.push({ locale, type: "SHORT", value: names.short });
    }
    if (typeof names.official === "string") {
      rows.push({ locale, type: "OFFICIAL", value: names.official });
    }
  }
  return rows;
}

/// What one entity is called for a reader of this locale, and what else it
/// answers to — `selectEntityName` plus the alias rule
/// (backend/src/modules/content/content.service.ts).
///
/// The candidates are what makes a Russian reader's card accept "Германия"
/// and an English one's accept both: the alias list is the entity's other
/// published names in the locales the request resolves through, and nothing
/// outside them.
function localizedNaming(rows, candidates) {
  const inCandidate = (type) =>
    candidates.flatMap((locale) =>
      rows.filter((row) => row.locale.toLowerCase() === locale && row.type === type),
    );
  const short = inCandidate("SHORT")[0] ?? rows[0];
  const official = inCandidate("OFFICIAL")[0];
  const aliases = candidates
    .flatMap((locale) => rows.filter((row) => row.locale.toLowerCase() === locale))
    .map(({ value }) => value)
    .filter((value) => value !== short?.value)
    .filter((value, index, values) => values.indexOf(value) === index);
  return {
    short: short?.value ?? "",
    official: official?.value ?? null,
    aliases,
  };
}

function buildAsset(asset, assetBaseUrl) {
  return {
    id: assetId(asset.key),
    type: mapAssetType(asset.assetType),
    variant: asset.variant ?? "current",
    // Every encoding, because which one to draw is the device's decision:
    // a 3x screen stores the 3x raster and a 2x one the 2x, exactly as
    // `ContentService` chooses it from a response.
    representations: asset.representations.map((representation) => ({
      url: `${assetBaseUrl}${representation.path}`,
      mimeType: representation.mimeType,
      sha256: representation.sha256,
      scale: representation.scale ?? null,
    })),
  };
}

async function buildSnapshot() {
  const release = await readRelease();
  const { manifest, catalog, entities, assets, templates, cardsByVariant } =
    release;
  const assetBaseUrl = manifest.assetBaseUrl;
  const locales = manifest.supportedLocales;
  const defaultLocale = manifest.defaultLocale;

  // Which decks reach which card, and whether they reach it as a preview.
  // This is the input `ContentAccessProjectionService` classifies from, and
  // it is built here the way the admin console builds it for a draft: from
  // the decks the release is about to publish.
  const reachByCard = new Map();
  const previewKeys = new Set();
  for (const deck of catalog.decks) {
    for (const member of deck.previewCards ?? []) {
      previewKeys.add(
        `${deck.key}:${member.entityKey}:${member.templateCode}:${member.templateSchemaVersion}`,
      );
    }
  }
  for (const deck of catalog.decks) {
    for (const card of deckMemberCards(deck, cardsByVariant)) {
      const preview = previewKeys.has(
        `${deck.key}:${card.entityKey}:${card.templateCode}:${card.templateSchemaVersion}`,
      );
      const reaches = reachByCard.get(card) ?? [];
      reaches.push({ deck, preview });
      reachByCard.set(card, reaches);
    }
  }

  const cardVisibility = new Map();
  for (const [card, reaches] of reachByCard) {
    // A card no published deck holds is withheld, for the same reason the
    // backend withholds it: no route serves it, so naming it can only tell a
    // stranger that it exists.
    cardVisibility.set(card, visibilityOf(reaches, "PAID_ONLY"));
  }

  // An entity is paid-only when every card that teaches it is. An entity no
  // card teaches at all is structure rather than merchandise and stays
  // public — but nothing in the app can reach it either, so only the subjects
  // of the cards below are carried.
  const reachByEntity = new Map();
  const reachByAsset = new Map();
  for (const [card, reaches] of reachByCard) {
    const existing = reachByEntity.get(card.entityKey) ?? [];
    reachByEntity.set(card.entityKey, [...existing, ...reaches]);
    const promptAssetKey = liveRevision(card).promptAssetKey;
    const assetReaches = reachByAsset.get(promptAssetKey) ?? [];
    reachByAsset.set(promptAssetKey, [...assetReaches, ...reaches]);
  }

  const publicEntityKeys = new Set(
    [...reachByEntity]
      .filter(([, reaches]) => isPubliclyVisible(visibilityOf(reaches, "PUBLIC")))
      .map(([key]) => key),
  );
  const isAssetPublic = (key) =>
    isPubliclyVisible(visibilityOf(reachByAsset.get(key) ?? [], "PAID_ONLY"));

  // MARK: Assets

  // Reachability, not ownership. An entity draws more than the flag its card
  // prompts with — a coat of arms, a map (ADR-020) — and a drawing no
  // published card prompts with is withheld even from the entity that owns it,
  // because that is what `assetVisibility` does: the projection publishes what
  // is known to be free rather than what has not yet been proved paid.
  const publicAssetKeys = new Set(
    [...reachByAsset.keys()].filter((key) => isAssetPublic(key)),
  );

  const snapshotAssets = [...publicAssetKeys]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => buildAsset(assets.get(key), assetBaseUrl));

  // MARK: Entities

  const snapshotEntities = [...publicEntityKeys]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((key) => {
      const entity = entities.get(key);
      const rows = entityNameRows(entity);
      const names = {};
      const facts = {};
      for (const locale of locales) {
        const candidates = localeCandidates(locale, defaultLocale);
        const naming = localizedNaming(rows, candidates);
        names[locale] =
          naming.official === null
            ? { short: naming.short }
            : { short: naming.short, official: naming.official };
        facts[locale] = factsOf(release.factsByEntity, key, locale).map(
          ({ type, displayValue, details, source }) => ({
            type,
            displayValue,
            // The record keeps the source's name and nothing else: the link
            // belongs to the sheet that cites it, and the client has never
            // stored one.
            source: source.name,
            ...(details === null ? {} : { details }),
          }),
        );
      }
      const record = {
        id: entityId(key),
        kind: mapEntityKind(entity.type),
        status: mapEntityStatus(entity.status),
        recognitionStatus: (
          entity.recognition?.status ?? "not_applicable"
        ).toUpperCase(),
        names,
      };
      // Absent rather than null throughout: one decoder reads this document
      // and takes a missing field as "the release published none", and 250
      // entities' worth of nulls is a tenth of a megabyte of binary saying
      // nothing.
      const entityAssetIDs = (entity.assetKeys ?? [])
        .filter((assetKey) => publicAssetKeys.has(assetKey))
        .map(assetId);
      if (entityAssetIDs.length > 0) record.assetIds = entityAssetIDs;
      const published = Object.fromEntries(
        Object.entries(facts).filter(([, values]) => values.length > 0),
      );
      if (Object.keys(published).length > 0) record.facts = published;
      const parent = entities.get(entity.parentKey ?? "");
      if (parent !== undefined) {
        // A summary rather than a reference: showing "California, United
        // States" must not depend on the parent's own record being there.
        record.parent = {
          id: entityId(entity.parentKey),
          kind: mapEntityKind(parent.type),
          names: Object.fromEntries(
            locales.map((locale) => [
              locale,
              localizedName(
                Object.fromEntries(
                  Object.entries(parent.names).map(([entryLocale, value]) => [
                    entryLocale,
                    value.short,
                  ]),
                ),
                locale,
              ) ?? "",
            ]),
          ),
        };
      }
      const identifiers = Object.fromEntries(
        Object.entries({
          isoSubdivision: entity.codes?.isoSubdivision,
          localCode: entity.codes?.localCode,
          fipsCode: entity.codes?.fipsCode,
        }).filter(([, value]) => typeof value === "string"),
      );
      if (Object.keys(identifiers).length > 0) record.identifiers = identifiers;
      return record;
    });

  // MARK: Cards

  const snapshotCards = [];
  const cardIdByCard = new Map();
  for (const [card, visibility] of cardVisibility) {
    if (!isPubliclyVisible(visibility)) continue;
    const entity = entities.get(card.entityKey);
    const revision = liveRevision(card);
    const asset = assets.get(revision.promptAssetKey);
    const template = templates.get(card.templateCode);
    if (entity === undefined || asset === undefined || template === undefined) {
      throw new Error(
        `${card.entityKey} refers to content the release does not publish`,
      );
    }
    if (!publicAssetKeys.has(revision.promptAssetKey)) {
      // A card whose drawing is withheld would draw an empty frame, which is
      // worse than one fewer country.
      continue;
    }
    const id = cardId(card);
    cardIdByCard.set(card, id);
    const rows = entityNameRows(entity);
    const answers = {};
    for (const locale of locales) {
      const naming = localizedNaming(rows, localeCandidates(locale, defaultLocale));
      answers[locale] =
        naming.aliases.length === 0
          ? { displayName: naming.short }
          : { displayName: naming.short, aliases: naming.aliases };
    }
    snapshotCards.push({
      id,
      entityId: entityId(card.entityKey),
      assetId: assetId(revision.promptAssetKey),
      templateCode: card.templateCode,
      templateSchemaVersion: card.templateSchemaVersion,
      semanticVersion: card.semanticVersion,
      revision: revision.revision,
      answerMode: template.gradingMode.toUpperCase(),
      answers,
    });
  }
  snapshotCards.sort((left, right) => left.id.localeCompare(right.id, "en"));

  // MARK: Decks

  const snapshotDecks = catalog.decks.map((deck) => {
    const access = deckAccess(deck);
    const open = isGrantedToAnonymous(deck);
    const members = deckMemberCards(deck, cardsByVariant);
    const names = {};
    for (const locale of locales) {
      const text =
        deck.names[locale] ?? deck.names[defaultLocale] ?? Object.values(deck.names)[0];
      names[locale] = { name: text.name, description: text.description };
    }
    const previewIDs = (deck.previewCards ?? [])
      .map((member) =>
        members.find(
          (card) =>
            card.entityKey === member.entityKey &&
            card.templateCode === member.templateCode &&
            card.templateSchemaVersion === member.templateSchemaVersion,
        ),
      )
      .map((card) => (card === undefined ? undefined : cardIdByCard.get(card)))
      .filter((id) => id !== undefined);
    return {
      id: deckId(deck.key),
      code: deckCode(deck.key),
      kind: deck.kind.toUpperCase(),
      names,
      // What the deck advertises, which is the whole of it whether or not
      // this device holds the cards.
      cardCount: deck.cardCount,
      contentKinds: deck.contentKinds ?? [],
      access: {
        model: access.model,
        requiredEntitlementKey: access.requiredEntitlementKey,
        // The store owns what a thing costs and the commerce endpoint says
        // which offer grants which right. A release publishes neither.
        offerCodes: [],
      },
      // A deck a stranger may open carries its cards. One that has to be
      // bought carries none: its cards live behind the entitlement guard, and
      // shipping them in a free binary would be giving them away.
      cardIds: open
        ? members
            .map((card) => cardIdByCard.get(card))
            .filter((id) => id !== undefined)
        : [],
      previewCardIds: open ? [] : previewIDs,
    };
  });

  return {
    schemaVersion: 1,
    contentVersion: BUNDLED_CONTENT_VERSION,
    releaseVersion: CONTENT_VERSION,
    // What the store records as the integrity mark of the release it holds. A
    // manifest fetched over the wire supplies its signature there; one that
    // was never fetched supplies the checksum of the document it came out of.
    releaseChecksum: createHash("sha256")
      .update(await readFile(join(bundleDirectory, "manifest.json")))
      .digest("hex"),
    manifest: {
      defaultLocale,
      supportedLocales: locales,
      supportedTemplateSchemaVersions: manifest.supportedTemplateSchemaVersions,
      assetBaseUrl,
      changeCursor: manifest.changeCursor,
    },
    assets: snapshotAssets,
    entities: snapshotEntities,
    cards: snapshotCards,
    decks: snapshotDecks,
  };
}

const checkOnly = process.argv.includes("--check");
const snapshot = stableJson(await buildSnapshot());

if (checkOnly) {
  const committed = await readFile(outputPath, "utf8").catch(() => "");
  if (committed !== snapshot) {
    process.stderr.write(
      "::error::The bundled catalogue is stale. Run ios/Scripts/sync-bundled-catalog.mjs and commit the result.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`The bundled catalogue matches ${CONTENT_VERSION}.\n`);
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, snapshot);
  const { decks, cards, entities, assets } = JSON.parse(snapshot);
  process.stdout.write(
    `Bundled ${String(decks.length)} decks, ${String(cards.length)} cards, ` +
      `${String(entities.length)} entities and ${String(assets.length)} assets ` +
      `from ${CONTENT_VERSION} (${String(Math.round(snapshot.length / 1024))} KB).\n`,
  );
}
