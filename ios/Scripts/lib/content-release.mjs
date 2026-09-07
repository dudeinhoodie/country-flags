// Reading one content release the way the backend reads it.
//
// Three build steps project the same directory into the app —
// `sync-flag-assets.mjs` copies its drawings, `sync-mock-content.mjs` turns it
// into the documents the Mock build serves, and `sync-bundled-catalog.mjs`
// turns it into the catalogue the app opens on before any network answers.
// All three have to agree about what a deck is called, which identifier a card
// carries and how a fact reads in a language, because a card seeded from the
// bundle and the same card downloaded a minute later must be the same card.
//
// So the projection lives here once and the three scripts differ only in what
// they write. Everything is derived from `content/generated/<version>`; nothing
// in this file is a source of truth of its own.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/// The release the app is built from.
///
/// One constant for every step, because the flags, the mock and the bundled
/// catalogue have to describe the same publication: a card whose checksum
/// names a drawing from another release would draw the placeholder, and a
/// catalogue no release published is exactly what ADR-011 forbids.
export const CONTENT_VERSION = "fixture-v1";

export const bundleDirectory = join(
  repositoryRoot,
  "content/generated",
  CONTENT_VERSION,
);

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readDocument(path) {
  return JSON.parse(await readFile(join(bundleDirectory, path), "utf8"));
}

/// The backend allocates content identifiers in its database, so nothing maps
/// a content key to a UUID outside one deployment. Every step here derives them
/// instead, by the same construction the publisher uses for source rows
/// (backend/src/modules/content/bundle/bundle-mapper.ts), so a rebuild does not
/// invalidate what a previous run stored on a device — and so the mock and the
/// bundled catalogue name the same card by the same identifier.
export function deterministicUuid(seed) {
  const bytes = Buffer.from(
    createHash("sha256").update(seed).digest().subarray(0, 16),
  );
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

export const entityId = (key) => deterministicUuid(`content-entity:${key}`);
export const assetId = (key) => deterministicUuid(`content-asset:${key}`);
export const deckId = (key) => deterministicUuid(`content-deck:${key}`);
export const cardId = (card) =>
  deterministicUuid(`content-card:${card.entityKey}:${card.semanticVersion}`);

/// A deck is published under its content key, and the contract requires a code
/// of `^[A-Z][A-Z0-9_]*$`, so `deck.europe` is served as `EUROPE`.
export function deckCode(key) {
  return key
    .replace(/^deck\./u, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "_");
}

/// The variant a card asks its question with. One entity is several questions —
/// a flag and a coat of arms are different cards with different schedules
/// (ADR-020) — so a card index keyed by the entity alone would serve the wrong
/// drawing.
export const cardVariantKey = (entityKey, templateCode, templateSchemaVersion) =>
  `${entityKey}:${templateCode}:${templateSchemaVersion}`;

/// The taxonomy values the publisher writes into the database
/// (backend/src/modules/content/bundle/bundle-mapper.ts). The pipeline speaks
/// lower case and the contract speaks upper, and two of them are not a
/// straight uppercasing: an "area" — Antarctica and the like — has no row of
/// its own, and a retired entity is served as hidden.
const ENTITY_KIND_BY_TYPE = {
  country: "COUNTRY",
  territory: "TERRITORY",
  subdivision: "SUBDIVISION",
  region: "REGION",
  subregion: "SUBREGION",
  area: "OTHER",
};

const ENTITY_STATUS_BY_STATUS = {
  active: "ACTIVE",
  historical: "HISTORICAL",
  hidden: "HIDDEN",
  retired: "HIDDEN",
};

export function mapEntityKind(type) {
  const kind = ENTITY_KIND_BY_TYPE[type];
  if (kind === undefined) throw new Error(`Unknown entity type ${type}`);
  return kind;
}

export function mapEntityStatus(status) {
  const mapped = ENTITY_STATUS_BY_STATUS[status];
  if (mapped === undefined) throw new Error(`Unknown entity status ${status}`);
  return mapped;
}

const ASSET_TYPE_MAP = {
  flag: "FLAG",
  coat_of_arms: "COAT_OF_ARMS",
  map: "MAP",
};

export function mapAssetType(assetType) {
  const mapped = ASSET_TYPE_MAP[assetType];
  if (mapped === undefined) throw new Error(`Unknown asset type ${assetType}`);
  return mapped;
}

/// The revision a client is served: the live one. A retired revision is
/// history the change feed carries rather than something to study.
export function liveRevision(card) {
  return card.revisions
    .filter(({ retiredAt }) => retiredAt === null)
    .sort((left, right) => right.revision - left.revision)[0];
}

// MARK: - Who may open a deck

/// What the release says about who may open a deck. Absent access means free,
/// which is what every deck published before ADR-019 is.
export function deckAccess(deck) {
  return {
    model: deck.access?.model ?? "FREE",
    requiredEntitlementKey: deck.access?.requiredEntitlementKey ?? null,
  };
}

/// `DeckAccessService.isGranted(deck, null)`, asked of a caller with no
/// account (backend/src/modules/commerce/deck-access.service.ts).
///
/// This is the whole of the public-projection rule, and it is deliberately the
/// same question the backend asks rather than a second one: what a stranger
/// may open is what the bundled catalogue may carry.
export function isGrantedToAnonymous(deck) {
  return deckAccess(deck).model === "FREE";
}

/// The visibility of one resource given every deck that reaches it, as
/// `ContentAccessProjectionService.visibilityOf` decides it
/// (backend/src/modules/content/content-access-projection.service.ts).
///
/// - `PUBLIC` — some deck a stranger may open reaches it;
/// - `PUBLIC_PREVIEW` — only locked decks reach it, and an editor published it
///   as one of their preview cards;
/// - `PAID_ONLY` — nothing a stranger may open reaches it.
///
/// - Parameter unreached: what a resource nothing reaches is. The fallback
///   differs by what is being classified — an unreachable drawing is withheld,
///   an unreachable entity is structure — so the caller states it.
export function visibilityOf(reaches, unreached) {
  if (reaches.length === 0) return unreached;
  if (reaches.some(({ deck }) => isGrantedToAnonymous(deck))) return "PUBLIC";
  return reaches.some(({ preview }) => preview) ? "PUBLIC_PREVIEW" : "PAID_ONLY";
}

/// Whether the public projection may carry a thing with this visibility.
export const isPubliclyVisible = (visibility) => visibility !== "PAID_ONLY";

// MARK: - Names

/// The name a locale reads, falling back the way the backend falls back: the
/// language without its region, then nothing.
export function localizedName(names, locale) {
  if (names === null || typeof names !== "object" || Array.isArray(names)) {
    return null;
  }
  for (const candidate of [locale, locale.split("-")[0] ?? locale]) {
    const name = names[candidate];
    if (typeof name === "string" && name.length > 0) return name;
  }
  return null;
}

/// The localized text of a deck or an entity, with the release's own fallback
/// chain: the locale asked for, then whatever the release published.
export function localizedText(names, locale, fallbackLocale) {
  return (
    names[locale] ??
    names[fallbackLocale] ??
    names[locale.split("-")[0]] ??
    Object.values(names)[0]
  );
}

// MARK: - Facts

/// The sources the pipeline names, as the publisher records them
/// (backend/src/modules/content/bundle/bundle-mapper.ts). A key with no entry
/// falls back the same way the publisher's does.
export const SOURCES = {
  annexare: {
    name: "annexare/Countries",
    url: "https://github.com/annexare/Countries",
  },
  cldr: {
    name: "Unicode CLDR",
    url: "https://github.com/unicode-org/cldr-json",
  },
  "world-bank": {
    name: "World Bank Open Data",
    url: "https://data.worldbank.org/",
  },
  wikidata: { name: "Wikidata", url: "https://www.wikidata.org/" },
  "flag-icons": {
    name: "lipis/flag-icons",
    url: "https://github.com/lipis/flag-icons",
  },
  editorial: {
    name: "Country Flags editorial overrides",
    url: "https://country-flags.app/content/editorial",
  },
};

export function sourceOf(record) {
  const key = record.provenance?.sourceKey;
  return (
    SOURCES[key] ?? {
      name: key ?? "unknown",
      url: `https://country-flags.app/content-sources/${key ?? "unknown"}`,
    }
  );
}

/// The fact collections a release publishes, by the type the contract names.
export const FACT_TYPES = {
  capitals: "CAPITAL",
  currencies: "CURRENCY",
  languages: "LANGUAGE",
  population: "POPULATION",
};

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value) => (Array.isArray(value) ? value : []);

const joined = (values) => (values.length > 0 ? values.join(", ") : null);

/// A name as a label rather than as a word in a sentence: English capitalises
/// a language or a currency lexically while CLDR gives the Russian common noun
/// in its dictionary form, and the same card should not look unfinished in one
/// locale. Mirrors `capitalized` in backend/src/modules/content/fact-display.ts.
function capitalized(name, locale) {
  const [first] = name;
  if (first === undefined) return name;
  const upper = first.toLocaleUpperCase(locale);
  return upper === first ? name : upper + name.slice(first.length);
}

/// A publisher that supplied a rendered value keeps it: that is the escape
/// hatch for a fact no rule here can shape.
function suppliedDisplayValue(value) {
  if (!isRecord(value)) return null;
  const supplied = value.displayValue;
  return typeof supplied === "string" && supplied.length > 0 ? supplied : null;
}

const displayNames = new Map();

function languageDisplayNames(locale) {
  let names = displayNames.get(locale);
  if (names === undefined) {
    names = new Intl.DisplayNames([locale], {
      type: "language",
      fallback: "none",
    });
    displayNames.set(locale, names);
  }
  return names;
}

function safeDisplayName(locale, code) {
  try {
    return languageDisplayNames(locale).of(code) ?? null;
  } catch {
    // `of` throws on a malformed tag rather than returning undefined.
    return null;
  }
}

function seatName(seat, locale) {
  // A seat has no code to fall back to the way a currency does, so English is
  // the fallback and the content schema requires it to be there. `name` is the
  // shape releases published before the seat carried a name map still hold.
  return (
    localizedName(seat.names, locale) ??
    localizedName(seat.names, "en") ??
    seat.name
  );
}

const officialSeats = (value) =>
  asArray(value)
    .filter(isRecord)
    .filter((seat) => seat.role === undefined || seat.role === "official");

const legalTenders = (value) =>
  asArray(value)
    .filter(isRecord)
    .filter((entry) => entry.role === undefined || entry.role === "legal_tender");

/// The line the backend composes on read
/// (backend/src/modules/content/fact-display.ts). A value whose shape is not
/// recognised yields null and the fact is left out, because a card that
/// reported its own JSON is the defect this exists to end.
export function factDisplayValue(factType, value, locale) {
  const supplied = suppliedDisplayValue(value);
  if (supplied !== null) return supplied;
  if (typeof value === "string") return value.length > 0 ? value : null;

  switch (factType) {
    case "CAPITAL":
      return joined(
        officialSeats(value)
          .map((seat) => seatName(seat, locale))
          .filter((name) => typeof name === "string")
          .map((name) => capitalized(name, locale)),
      );
    case "POPULATION": {
      if (!isRecord(value)) return null;
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
        return null;
      }
      const formatted = new Intl.NumberFormat(locale).format(value.value);
      return typeof value.year === "number"
        ? `${formatted} (${String(value.year)})`
        : formatted;
    }
    case "CURRENCY":
      return joined(
        legalTenders(value)
          .map((entry) => {
            if (typeof entry.code !== "string") return null;
            const name = localizedName(entry.names, locale);
            return name === null
              ? entry.code
              : `${capitalized(name, locale)} (${entry.code})`;
          })
          .filter((entry) => entry !== null),
      );
    case "LANGUAGE":
      return joined(
        asArray(value)
          .filter(isRecord)
          .map((entry) => {
            const published = localizedName(entry.names, locale);
            if (published !== null) return published;
            return typeof entry.code === "string"
              ? safeDisplayName(locale, entry.code)
              : null;
          })
          .filter((name) => name !== null)
          .map((name) => capitalized(name, locale)),
      );
    default:
      return null;
  }
}

/// The same fact with its parts still apart, as `factDetails` hands them over
/// (backend/src/modules/content/fact-display.ts).
///
/// The screen reads these rather than the line: a population becomes "8.4M"
/// with its year in the label, a currency drops the code printed on the note.
/// A catalogue seeded without them would word every card differently from the
/// same card downloaded, which is the drift this whole file exists to prevent.
export function factDetails(factType, value, locale) {
  // A supplied line is prose by definition: there is nothing structured
  // behind it to hand over.
  if (suppliedDisplayValue(value) !== null || typeof value === "string") {
    return null;
  }
  switch (factType) {
    case "CAPITAL": {
      const seats = officialSeats(value).flatMap((seat) => {
        const name = seatName(seat, locale);
        if (typeof name !== "string" || name.length === 0) return [];
        return [
          {
            name: capitalized(name, locale),
            role: typeof seat.role === "string" ? seat.role : null,
          },
        ];
      });
      return seats.length > 0 ? { kind: "capital", seats } : null;
    }
    case "CURRENCY": {
      const tenders = legalTenders(value).flatMap((entry) => {
        if (typeof entry.code !== "string" || entry.code.length === 0) return [];
        // The code stands in for a name the release never carried, the same
        // way the rendered line falls back to it.
        const name = localizedName(entry.names, locale);
        return [
          {
            code: entry.code,
            name: name === null ? entry.code : capitalized(name, locale),
            role: typeof entry.role === "string" ? entry.role : null,
          },
        ];
      });
      return tenders.length > 0 ? { kind: "currency", tenders } : null;
    }
    case "LANGUAGE": {
      const languages = asArray(value)
        .filter(isRecord)
        .flatMap((entry) => {
          const named =
            localizedName(entry.names, locale) ??
            (typeof entry.code === "string"
              ? safeDisplayName(locale, entry.code)
              : null);
          if (named === null) return [];
          return [
            {
              code: typeof entry.code === "string" ? entry.code : null,
              name: capitalized(named, locale),
            },
          ];
        });
      return languages.length > 0 ? { kind: "language", languages } : null;
    }
    case "POPULATION": {
      if (!isRecord(value)) return null;
      if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
        return null;
      }
      return {
        kind: "population",
        // Unformatted: grouping a number is a locale decision the screen
        // makes, and it is the one thing the rendered line cannot be undone
        // into.
        value: value.value,
        year: typeof value.year === "number" ? value.year : null,
      };
    }
    default:
      return null;
  }
}

// MARK: - The release

/// Everything the three projections read, loaded once and indexed.
export async function readRelease() {
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

  return {
    manifest,
    catalog,
    learningCards,
    cardTemplates,
    assetRegistry,
    factsByEntity,
    entities: new Map(catalog.entities.map((entity) => [entity.key, entity])),
    assets: new Map(assetRegistry.assets.map((asset) => [asset.key, asset])),
    templates: new Map(
      cardTemplates.templates.map((template) => [template.code, template]),
    ),
    // Keyed by the variant, because one entity is several questions: a card
    // index keyed by the entity would serve a country's coat of arms wherever
    // its flag was asked for.
    cardsByVariant: new Map(
      learningCards.cards
        .filter(({ status }) => status === "active")
        .map((card) => [
          cardVariantKey(
            card.entityKey,
            card.templateCode,
            card.templateSchemaVersion,
          ),
          card,
        ]),
    ),
  };
}

/// The cards of one deck, in the editorial order a learner walks it in.
export function deckMemberCards(deck, cardsByVariant) {
  return deck.memberCards
    .map((member) =>
      cardsByVariant.get(
        cardVariantKey(
          member.entityKey,
          member.templateCode,
          member.templateSchemaVersion,
        ),
      ),
    )
    .filter((card) => card !== undefined);
}

/// The facts of one entity in one locale, ordered by type as the API orders
/// them.
export function factsOf(factsByEntity, entityKey, locale) {
  return (factsByEntity.get(entityKey) ?? [])
    .map(({ factType, record }) => {
      const displayValue = factDisplayValue(factType, record.value, locale);
      if (displayValue === null) return null;
      const details = factDetails(factType, record.value, locale);
      return {
        type: factType,
        displayValue,
        details,
        source: sourceOf(record),
      };
    })
    .filter((fact) => fact !== null)
    .sort((left, right) => left.type.localeCompare(right.type, "en"));
}
