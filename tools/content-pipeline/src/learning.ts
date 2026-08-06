import type { BuiltAsset } from "./assets.js";
import { sha256 } from "./stable-json.js";

const TEMPLATE_CODE = "FLAG_TO_COUNTRY";
const TEMPLATE_SCHEMA_VERSION = 1;

interface CatalogDeck {
  key: string;
  memberEntityKeys: string[];
}

export interface LearningContent {
  cardTemplates: Record<string, unknown>;
  learningCards: Record<string, unknown>;
}

/**
 * Derives the deterministic learning content (card templates and one
 * flag-to-country learning card per catalog member) from the built catalog and
 * asset registry. Runs inside `content build`, so the generated bundle always
 * carries these files and stays byte-identical across offline rebuilds.
 */
export function buildLearningContent(
  decks: CatalogDeck[],
  assets: BuiltAsset[],
  createdAt: string,
): LearningContent {
  const allDeck = decks.find(({ key }) => key === "deck.all");
  if (allDeck === undefined) {
    throw new Error("Catalog must contain deck.all to derive learning cards");
  }

  const assetsByEntity = new Map<string, BuiltAsset[]>();
  for (const asset of assets) {
    const list = assetsByEntity.get(asset.entityKey) ?? [];
    list.push(asset);
    assetsByEntity.set(asset.entityKey, list);
  }

  const cards = [...allDeck.memberEntityKeys]
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((entityKey) => {
      const entityAssets = (assetsByEntity.get(entityKey) ?? []).sort(
        (left, right) => left.key.localeCompare(right.key, "en"),
      );
      const promptAsset = entityAssets[0];
      if (promptAsset === undefined) {
        throw new Error(`Entity ${entityKey} has no flag asset for its card`);
      }
      return {
        entityKey,
        templateCode: TEMPLATE_CODE,
        templateSchemaVersion: TEMPLATE_SCHEMA_VERSION,
        semanticVersion: 1,
        supersedesSemanticVersion: null,
        status: "active",
        revisions: [
          {
            revision: 1,
            promptAssetKey: promptAsset.key,
            promptFingerprint: sha256(
              `${entityKey}:${TEMPLATE_CODE}:1:${promptAsset.sha256}`,
            ),
            changeClassification: "technical",
            progressPolicy: "preserve",
            effectiveFrom: createdAt,
            retiredAt: null,
          },
        ],
      };
    });

  return {
    cardTemplates: {
      $schema: "../../schemas/card-templates.schema.json",
      schemaVersion: 1,
      templates: [
        {
          code: TEMPLATE_CODE,
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          promptType: "FLAG_ASSET",
          answerType: "GEO_ENTITY_NAME",
          gradingMode: "self_rated",
          promptSpec: { assetType: "FLAG" },
          answerSpec: { nameType: "SHORT" },
          backSideFactTypes: ["capital", "population", "currency", "language"],
          status: "published",
        },
      ],
    },
    learningCards: {
      $schema: "../../schemas/learning-cards.schema.json",
      schemaVersion: 1,
      cards,
    },
  };
}
