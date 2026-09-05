import { loadBundle, type LoadedBundle } from "./bundle-reader";
import { validateBundleSchemas } from "./bundle-schema-validator";
import { verifyManifestSignature } from "./bundle-signer";
import {
  parseBundleDomain,
  type BundleDomain,
  type DomainAsset,
} from "./bundle-domain";
import {
  DECK_CODE_PATTERN,
  deckCodeFromKey,
  slugFromEntityKey,
} from "./bundle-mapper";

export class BundleValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Bundle validation failed with ${String(issues.length)} issue(s):\n${issues.join("\n")}`,
    );
    this.name = "BundleValidationError";
  }
}

export interface ValidatedBundle {
  bundle: LoadedBundle;
  domain: BundleDomain;
}

function cardKey(
  entityKey: string,
  templateCode: string,
  semanticVersion: number,
): string {
  return `${entityKey}:${templateCode}:${String(semanticVersion)}`;
}

/**
 * A release must not publish a flag no client can draw. The catalogue shipped
 * SVG only until issue #82, which downloaded and verified perfectly and never
 * rendered on iOS, so the raster is checked here rather than discovered on a
 * device.
 *
 * A vector is optional: an editorial override may supply a drawing that
 * never had one, and inventing a vector would be worse than not publishing
 * it. When a vector is present it leads and carries no scale — the order is
 * the contract, a client reads this list top down.
 */
function representationIssues(asset: DomainAsset): string[] {
  const issues: string[] = [];
  const [first, ...rest] = asset.representations;

  if (first === undefined) {
    issues.push(`asset ${asset.key} publishes no representation`);
    return issues;
  }

  const hasVector = asset.representations.some(
    ({ mimeType }) => mimeType === "image/svg+xml",
  );
  if (hasVector) {
    if (first.mimeType !== "image/svg+xml") {
      issues.push(`asset ${asset.key} does not lead with its vector original`);
    }
    if (rest.some(({ mimeType }) => mimeType === "image/svg+xml")) {
      issues.push(`asset ${asset.key} publishes more than one vector`);
    }
  }
  if (first.mimeType === "image/svg+xml" && first.scale !== undefined) {
    issues.push(`asset ${asset.key} gives its vector original a screen scale`);
  }

  const raster = asset.representations.filter(
    ({ mimeType }) => mimeType !== "image/svg+xml",
  );
  if (raster.length === 0) {
    issues.push(
      `asset ${asset.key} publishes no raster representation, so a client that cannot render vectors has nothing to draw`,
    );
  }

  // A lone raster needs no scale — the client's fallback draws it anyway.
  // Two rasters without scales are indistinguishable, so from the second
  // raster on, every one must say what screen it was rendered for.
  if (raster.length > 1) {
    let previousScale = 0;
    for (const representation of raster) {
      if (representation.scale === undefined) {
        issues.push(
          `asset ${asset.key} publishes several rasters and one has no screen scale`,
        );
        continue;
      }
      if (representation.scale <= previousScale) {
        issues.push(
          `asset ${asset.key} does not order its raster representations by ascending scale`,
        );
      }
      previousScale = representation.scale;
    }
  }

  const paths = new Set(asset.representations.map(({ path }) => path));
  if (paths.size !== asset.representations.length) {
    issues.push(`asset ${asset.key} publishes the same file twice`);
  }

  return issues;
}

function collectReferenceIssues(domain: BundleDomain): string[] {
  const issues: string[] = [];
  const entityByKey = new Map(domain.catalog.entities.map((e) => [e.key, e]));
  const assetByKey = new Map(domain.assets.map((a) => [a.key, a]));
  const templateByKey = new Map(
    domain.cardTemplates.map((t) => [
      `${t.code}:${String(t.schemaVersion)}`,
      t,
    ]),
  );
  const cardsByKey = new Map(
    domain.learningCards.map((c) => [
      cardKey(c.entityKey, c.templateCode, c.semanticVersion),
      c,
    ]),
  );

  // Slugs are derived by dropping the key's namespace prefix and must stay
  // unique — geo_entities.slug is a unique column, so a collision that reached
  // publish would only surface as an opaque constraint error mid-transaction.
  const entityKeyBySlug = new Map<string, string>();
  for (const entity of domain.catalog.entities) {
    const slug = slugFromEntityKey(entity.key);
    const owner = entityKeyBySlug.get(slug);
    if (owner === undefined) {
      entityKeyBySlug.set(slug, entity.key);
    } else {
      issues.push(
        `entities ${owner} and ${entity.key} both map to slug "${slug}"; rename one editorially`,
      );
    }
  }

  for (const relation of domain.catalog.relations) {
    if (!entityByKey.has(relation.parentKey)) {
      issues.push(
        `relation references unknown parentKey ${relation.parentKey}`,
      );
    }
    if (!entityByKey.has(relation.childKey)) {
      issues.push(`relation references unknown childKey ${relation.childKey}`);
    }
  }

  // A deck is served under a code derived from its key, and decks.code is a
  // unique column: two keys deriving one code would publish as a single deck
  // holding both memberships rather than as the two the catalogue describes.
  const deckKeyByCode = new Map<string, string>();
  for (const deck of domain.catalog.decks) {
    const code = deckCodeFromKey(deck.key);
    if (!DECK_CODE_PATTERN.test(code)) {
      issues.push(
        `deck ${deck.key} derives the code "${code}", which the contract does not allow; rename it editorially`,
      );
    }
    const owner = deckKeyByCode.get(code);
    if (owner === undefined) {
      deckKeyByCode.set(code, deck.key);
    } else {
      issues.push(
        `decks ${owner} and ${deck.key} both derive the code "${code}"; rename one editorially`,
      );
    }

    for (const memberKey of deck.memberEntityKeys) {
      if (!entityByKey.has(memberKey)) {
        issues.push(`deck ${deck.key} references unknown entity ${memberKey}`);
      }
    }

    // A member names a card variant, and the publisher materializes it by
    // that name. One that resolves to nothing would drop out of the deck at
    // publish time without a word, which is how a deck of fifty states
    // could be released holding thirty.
    for (const member of deck.memberCards) {
      const key = cardKey(member.entityKey, member.templateCode, 1);
      if (
        ![...cardsByKey.keys()].some((candidate) =>
          candidate.startsWith(`${member.entityKey}:${member.templateCode}:`),
        )
      ) {
        issues.push(
          `deck ${deck.key} holds ${key}, which this release does not publish`,
        );
      }
    }

    if (deck.cardCount !== deck.memberCards.length) {
      issues.push(
        `deck ${deck.key} says it holds ${String(deck.cardCount)} cards and lists ${String(deck.memberCards.length)}`,
      );
    }
  }

  for (const asset of domain.assets) {
    if (!entityByKey.has(asset.entityKey)) {
      issues.push(
        `asset ${asset.key} references unknown entity ${asset.entityKey}`,
      );
    }
    if (asset.license.trim().length === 0) {
      issues.push(`asset ${asset.key} has an empty license`);
    }
    issues.push(...representationIssues(asset));
  }

  for (const collection of domain.facts) {
    for (const record of collection.records) {
      if (!entityByKey.has(record.entityKey)) {
        issues.push(
          `${collection.factType} fact references unknown entity ${record.entityKey}`,
        );
      }
    }
  }

  for (const card of domain.learningCards) {
    if (!entityByKey.has(card.entityKey)) {
      issues.push(`learning card references unknown entity ${card.entityKey}`);
    }
    if (
      !templateByKey.has(
        `${card.templateCode}:${String(card.templateSchemaVersion)}`,
      )
    ) {
      issues.push(
        `learning card for ${card.entityKey} references unknown template ${card.templateCode}:${String(card.templateSchemaVersion)}`,
      );
    }
    if (card.supersedesSemanticVersion !== null) {
      const supersededKey = cardKey(
        card.entityKey,
        card.templateCode,
        card.supersedesSemanticVersion,
      );
      if (!cardsByKey.has(supersededKey)) {
        issues.push(
          `learning card ${cardKey(card.entityKey, card.templateCode, card.semanticVersion)} supersedes a missing card version ${String(card.supersedesSemanticVersion)}`,
        );
      }
    }
    for (const revision of card.revisions) {
      if (
        revision.promptAssetKey !== null &&
        !assetByKey.has(revision.promptAssetKey)
      ) {
        issues.push(
          `learning card ${card.entityKey}:${card.templateCode} revision ${String(revision.revision)} references unknown asset ${revision.promptAssetKey}`,
        );
      }
    }
  }

  return issues;
}

/**
 * The taxonomy that says which country an administrative unit belongs to.
 *
 * Published verbatim as `geo_relations.taxonomy_code`, and kept apart from
 * the geographic classifications: Europe contains France as a matter of
 * where it is, the United States contains California as a matter of what it
 * is (ADR-020).
 */
export const ADMINISTRATIVE_TAXONOMY_KEY = "taxonomy.administrative";

const ADMINISTRATIVE_PARENT_TYPES = new Set(["country", "territory"]);

/**
 * What has to be true of a subdivision before it can be published.
 *
 * A state sits in the same table as a country, so nothing but these rules
 * stops it from behaving like one: appearing in the all-countries deck,
 * claiming a recognition status that means nothing for it, or floating with
 * no country above it at all. The checks run here, over the whole bundle,
 * because that is where every entity and every relation is visible at once.
 */
function collectSubdivisionIssues(domain: BundleDomain): string[] {
  const issues: string[] = [];
  const entityByKey = new Map(domain.catalog.entities.map((e) => [e.key, e]));
  const administrative = domain.catalog.relations.filter(
    (relation) =>
      relation.taxonomyKey === ADMINISTRATIVE_TAXONOMY_KEY &&
      relation.relationType === "contains",
  );

  const parentsByChild = new Map<string, string[]>();
  for (const relation of administrative) {
    const child = entityByKey.get(relation.childKey);
    if (child !== undefined && child.type !== "subdivision") {
      issues.push(
        `administrative relation places ${relation.childKey} under ${relation.parentKey}, but ${relation.childKey} is a ${child.type} rather than a subdivision`,
      );
    }
    if (!relation.primary) {
      continue;
    }
    parentsByChild.set(relation.childKey, [
      ...(parentsByChild.get(relation.childKey) ?? []),
      relation.parentKey,
    ]);
  }

  for (const entity of domain.catalog.entities) {
    if (entity.type !== "subdivision") {
      continue;
    }
    if (entity.includeInCountryCatalog) {
      issues.push(
        `subdivision ${entity.key} is listed in the country catalog; a state is not a country`,
      );
    }
    if (entity.recognition.status !== "not_applicable") {
      issues.push(
        `subdivision ${entity.key} declares recognition status ${entity.recognition.status}; recognition is not applicable to an administrative unit`,
      );
    }

    const parents = parentsByChild.get(entity.key) ?? [];
    if (parents.length === 0) {
      issues.push(
        `subdivision ${entity.key} has no primary administrative parent`,
      );
      continue;
    }
    if (parents.length > 1) {
      issues.push(
        `subdivision ${entity.key} has ${String(parents.length)} primary administrative parents (${parents.join(", ")}); it belongs to exactly one`,
      );
    }
    for (const parentKey of parents) {
      const parent = entityByKey.get(parentKey);
      if (parent === undefined) {
        // Already reported as an unknown parentKey by the reference checks.
        continue;
      }
      if (!ADMINISTRATIVE_PARENT_TYPES.has(parent.type)) {
        issues.push(
          `subdivision ${entity.key} belongs to ${parentKey}, which is a ${parent.type} rather than a country or territory`,
        );
      }
    }
  }

  issues.push(...administrativeCycleIssues(parentsByChild));

  return issues;
}

/**
 * A unit cannot contain the country that contains it.
 *
 * The walk is bounded by the number of relations, so a cycle is reported
 * rather than followed: publishing one would hang every reader that asks
 * what a subdivision belongs to.
 */
function administrativeCycleIssues(
  parentsByChild: Map<string, string[]>,
): string[] {
  const issues: string[] = [];
  for (const start of parentsByChild.keys()) {
    const seen = new Set<string>([start]);
    let current = start;
    for (;;) {
      const [parent] = parentsByChild.get(current) ?? [];
      if (parent === undefined) {
        break;
      }
      if (seen.has(parent)) {
        issues.push(`administrative relations form a cycle through ${parent}`);
        break;
      }
      seen.add(parent);
      current = parent;
    }
  }
  return [...new Set(issues)];
}

function collectLocaleIssues(
  domain: BundleDomain,
  manifestSupportedLocales: string[],
): string[] {
  const issues: string[] = [];

  for (const entity of domain.catalog.entities) {
    if (!entity.includeInCountryCatalog) {
      continue;
    }
    for (const locale of domain.catalog.supportedLocales) {
      if (entity.names[locale] === undefined) {
        issues.push(`entity ${entity.key} is missing a ${locale} name`);
      }
    }
  }

  for (const locale of manifestSupportedLocales) {
    if (!domain.catalog.supportedLocales.includes(locale)) {
      issues.push(
        `manifest supports locale ${locale} which catalog.supportedLocales does not declare`,
      );
    }
  }

  return issues;
}

export async function validateBundle(
  bundleDir: string,
  publicKeysByKeyId: Record<string, string>,
): Promise<ValidatedBundle> {
  const bundle = await loadBundle(bundleDir);
  await validateBundleSchemas(bundle);

  if (!verifyManifestSignature(bundle.manifest, publicKeysByKeyId)) {
    throw new BundleValidationError([
      `manifest signature is invalid or its keyId (${bundle.manifest.signature.keyId}) is unknown`,
    ]);
  }

  const domain = parseBundleDomain(bundle);
  const issues = [
    ...collectReferenceIssues(domain),
    ...collectSubdivisionIssues(domain),
    ...collectLocaleIssues(domain, bundle.manifest.supportedLocales),
  ];

  if (issues.length > 0) {
    throw new BundleValidationError(issues);
  }

  return { bundle, domain };
}
