import type {
  EditorialAssetOverride,
  EditorialAssetOverrideV2,
  EditorialCatalog,
  EditorialCatalogV2,
  EditorialCardRef,
  EditorialCardVariantRef,
  EditorialDeck,
  EditorialDeckV2,
  EditorialDocument,
} from "./types.js";

/** The version the pipeline works in. Anything older is lifted on read. */
export const EDITORIAL_SCHEMA_VERSION = 3;

/**
 * What a v2 deck taught.
 *
 * Every card the catalog has ever published shows a flag and asks for the
 * entity, so a member key that names no template means this one. Writing the
 * default down rather than inferring it later is the point of the lift: after
 * it, nothing downstream has to guess what an old deck meant.
 */
export const DEFAULT_TEMPLATE_CODE = "FLAG_TO_COUNTRY";
export const DEFAULT_TEMPLATE_SCHEMA_VERSION = 1;

/** The drawing in force, as opposed to a historical or ceremonial one. */
export const DEFAULT_ASSET_VARIANT = "current";

function liftDeck(deck: EditorialDeckV2): EditorialDeck {
  return {
    ...deck,
    defaultTemplateCode: DEFAULT_TEMPLATE_CODE,
    defaultTemplateSchemaVersion: DEFAULT_TEMPLATE_SCHEMA_VERSION,
  };
}

function liftAssetOverride(
  override: EditorialAssetOverrideV2,
): EditorialAssetOverride {
  return { ...override, variant: DEFAULT_ASSET_VARIANT };
}

/**
 * Reads the editorial document whatever version it was written in.
 *
 * The catalog on disk is still v2 and the console still writes v2, so the
 * pipeline lifts rather than demands: a v2 document becomes a v3 one whose
 * decks teach flags and whose overrides replace the current drawing, which is
 * exactly what they already meant. The reverse is never true, so the lift is
 * one-way and the document is rewritten in the version it declares until the
 * flip happens in one reviewed change (#314).
 *
 * An unknown version is an error rather than a guess. A v1 document is lifted
 * by the backend on read (ADR-015) and never reaches the pipeline.
 */
export function migrateEditorialCatalog(
  document: EditorialDocument,
): EditorialCatalog {
  // The version comes off disk, so it is read as the number it is rather
  // than as the union member it claims to be: a document that lies about
  // its shape has to fail here, not three files later.
  const version: number = document.schemaVersion;
  if (version === EDITORIAL_SCHEMA_VERSION) {
    return document as EditorialCatalog;
  }
  if (version !== 2) {
    throw new Error(
      `editorial catalog declares schema version ${String(
        version,
      )}; the pipeline reads 2 or ${String(EDITORIAL_SCHEMA_VERSION)}`,
    );
  }
  const { decks, assetOverrides, ...rest } = document as EditorialCatalogV2;
  return {
    ...rest,
    schemaVersion: EDITORIAL_SCHEMA_VERSION,
    decks: decks.map(liftDeck),
    ...(assetOverrides === undefined
      ? {}
      : { assetOverrides: assetOverrides.map(liftAssetOverride) }),
  };
}

/**
 * The card variant a member stands for.
 *
 * A bare key takes the deck's default template. A deck that lists bare keys
 * without declaring one is refused by the schema, so the fallback here is a
 * belt on top of that rather than a second opinion about what the deck meant.
 */
export function cardVariantRef(
  deck: EditorialDeck,
  member: EditorialCardRef,
): EditorialCardVariantRef {
  if (typeof member !== "string") {
    return member;
  }
  return {
    entityKey: member,
    templateCode: deck.defaultTemplateCode ?? DEFAULT_TEMPLATE_CODE,
    templateSchemaVersion:
      deck.defaultTemplateSchemaVersion ?? DEFAULT_TEMPLATE_SCHEMA_VERSION,
  };
}

/** The entity a member is about, whichever way it was written. */
export function memberEntityKey(member: EditorialCardRef): string {
  return typeof member === "string" ? member : member.entityKey;
}
