import type { BuiltAsset } from "./assets.js";
import { DEFAULT_ASSET_VARIANT } from "./editorial-schema.js";
import { sha256 } from "./stable-json.js";
import type { EditorialAssetType } from "./types.js";

export const FLAG_TEMPLATE_CODE = "FLAG_TO_COUNTRY";
export const COAT_TEMPLATE_CODE = "COAT_OF_ARMS_TO_COUNTRY";
const TEMPLATE_SCHEMA_VERSION = 1;

/**
 * A template and the drawing it asks a question with.
 *
 * The prompt type is what turns a template into a card: a country with a
 * flag and no coat of arms publishes one card, not two, and the reader never
 * meets a question with nothing to show (ADR-020).
 */
interface TemplateDefinition {
  code: string;
  schemaVersion: number;
  promptAssetType: EditorialAssetType;
  promptType: string;
  document: Record<string, unknown>;
}

const TEMPLATES: TemplateDefinition[] = [
  {
    code: FLAG_TEMPLATE_CODE,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    promptAssetType: "flag",
    promptType: "FLAG_ASSET",
    document: {
      code: FLAG_TEMPLATE_CODE,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      promptType: "FLAG_ASSET",
      answerType: "GEO_ENTITY_NAME",
      gradingMode: "self_rated",
      promptSpec: { assetType: "FLAG" },
      answerSpec: { nameType: "SHORT" },
      backSideFactTypes: ["capital", "population", "currency", "language"],
      status: "published",
    },
  },
  {
    code: COAT_TEMPLATE_CODE,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    promptAssetType: "coat_of_arms",
    promptType: "COAT_OF_ARMS_ASSET",
    document: {
      code: COAT_TEMPLATE_CODE,
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      promptType: "COAT_OF_ARMS_ASSET",
      answerType: "GEO_ENTITY_NAME",
      gradingMode: "self_rated",
      promptSpec: { assetType: "COAT_OF_ARMS" },
      answerSpec: { nameType: "SHORT" },
      backSideFactTypes: ["capital", "population", "currency", "language"],
      status: "published",
    },
  },
];

const TEMPLATE_BY_CODE = new Map(
  TEMPLATES.map((template) => [template.code, template]),
);

export interface CardVariant {
  entityKey: string;
  templateCode: string;
  templateSchemaVersion: number;
}

/** One card variant as a comparable string. */
export function variantKey(variant: CardVariant): string {
  return `${variant.entityKey}:${variant.templateCode}:${String(
    variant.templateSchemaVersion,
  )}`;
}

/** The drawing a template asks its question with, if the template is known. */
export function promptAssetTypeOf(
  templateCode: string,
): EditorialAssetType | undefined {
  return TEMPLATE_BY_CODE.get(templateCode)?.promptAssetType;
}

export interface LearningContent {
  cardTemplates: Record<string, unknown>;
  learningCards: Record<string, unknown>;
}

/// The checksum of the asset's vector original.
///
/// Chosen by media type rather than by position: the list is ordered vector
/// first today, and a fingerprint that silently followed the order would give
/// every card a new revision the day that changed.
function vectorChecksum(asset: BuiltAsset): string {
  const vector = asset.representations.find(
    (representation) => representation.mimeType === "image/svg+xml",
  );
  if (vector === undefined) {
    throw new Error(`${asset.key} publishes no vector representation`);
  }
  return vector.sha256;
}

function promptAssetOf(
  assets: BuiltAsset[],
  templateCode: string,
): BuiltAsset | undefined {
  const template = TEMPLATE_BY_CODE.get(templateCode);
  if (template === undefined) {
    return undefined;
  }
  return assets.find(
    (asset) =>
      asset.assetType === template.promptAssetType &&
      asset.variant === DEFAULT_ASSET_VARIANT,
  );
}

/**
 * Which cards this release can publish.
 *
 * One entity is several questions now: Germany's flag and Germany's coat of
 * arms are different cards with different schedules, and a deck says which of
 * them it holds. A variant whose drawing is missing is left out rather than
 * published as an empty frame — the flag beside it is unaffected, which is
 * the whole point of keeping the symbols apart.
 */
export function resolveCardVariants(
  requested: CardVariant[],
  assets: BuiltAsset[],
): { published: CardVariant[]; missing: CardVariant[] } {
  const assetsByEntity = new Map<string, BuiltAsset[]>();
  for (const asset of assets) {
    const list = assetsByEntity.get(asset.entityKey) ?? [];
    list.push(asset);
    assetsByEntity.set(asset.entityKey, list);
  }

  const seen = new Set<string>();
  const published: CardVariant[] = [];
  const missing: CardVariant[] = [];
  for (const variant of requested) {
    const identity = `${variant.entityKey}:${variant.templateCode}:${String(
      variant.templateSchemaVersion,
    )}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    const entityAssets = assetsByEntity.get(variant.entityKey) ?? [];
    if (promptAssetOf(entityAssets, variant.templateCode) === undefined) {
      missing.push(variant);
      continue;
    }
    published.push(variant);
  }

  // By entity first, exactly as the card list has always been ordered, then
  // by template. Sorting a joined string instead would collate the
  // separator and quietly reshuffle every card whose neighbour's key
  // contains a hyphen.
  const byEntityThenTemplate = (
    left: CardVariant,
    right: CardVariant,
  ): number =>
    left.entityKey === right.entityKey
      ? left.templateCode.localeCompare(right.templateCode, "en")
      : left.entityKey.localeCompare(right.entityKey, "en");
  published.sort(byEntityThenTemplate);
  missing.sort(byEntityThenTemplate);
  return { published, missing };
}

/**
 * Derives the deterministic learning content — card templates and one card
 * per publishable variant — from the built catalog and asset registry. Runs
 * inside `content build`, so the generated bundle always carries these files
 * and stays byte-identical across offline rebuilds.
 */
export function buildLearningContent(
  variants: CardVariant[],
  assets: BuiltAsset[],
  createdAt: string,
): LearningContent {
  const assetsByEntity = new Map<string, BuiltAsset[]>();
  for (const asset of assets) {
    const list = assetsByEntity.get(asset.entityKey) ?? [];
    list.push(asset);
    assetsByEntity.set(asset.entityKey, list);
  }

  const cards = variants.map((variant) => {
    const entityAssets = (assetsByEntity.get(variant.entityKey) ?? []).sort(
      (left, right) => left.key.localeCompare(right.key, "en"),
    );
    const promptAsset = promptAssetOf(entityAssets, variant.templateCode);
    if (promptAsset === undefined) {
      throw new Error(
        `${variant.entityKey} has no ${variant.templateCode} prompt asset for its card`,
      );
    }
    return {
      entityKey: variant.entityKey,
      templateCode: variant.templateCode,
      templateSchemaVersion: variant.templateSchemaVersion,
      semanticVersion: 1,
      supersedesSemanticVersion: null,
      status: "active",
      revisions: [
        {
          revision: 1,
          promptAssetKey: promptAsset.key,
          // The vector's checksum, which is what this fingerprint has
          // always been built on. It used to sit on the asset itself; it now
          // lives in the representation that carries the vector, and the
          // value is the same one — so no card gains a revision for a field
          // moving.
          promptFingerprint: sha256(
            `${variant.entityKey}:${variant.templateCode}:1:${vectorChecksum(promptAsset)}`,
          ),
          changeClassification: "technical",
          progressPolicy: "preserve",
          effectiveFrom: createdAt,
          retiredAt: null,
        },
      ],
    };
  });

  // Only the templates this release actually teaches. A template nobody
  // holds a card for would publish a question the catalog cannot ask.
  const usedCodes = new Set(cards.map((card) => card.templateCode));

  return {
    cardTemplates: {
      $schema: "../../schemas/card-templates.schema.json",
      schemaVersion: 1,
      templates: TEMPLATES.filter((template) =>
        usedCodes.has(template.code),
      ).map((template) => template.document),
    },
    learningCards: {
      $schema: "../../schemas/learning-cards.schema.json",
      schemaVersion: 1,
      cards,
    },
  };
}
