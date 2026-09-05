import { Injectable } from "@nestjs/common";

import { deckCodeFromKey } from "../content/bundle/bundle-mapper";

import {
  currentEntityKeys,
  isLearnable,
  memberCardRef,
  membersMode,
  resolveDeckMembers,
} from "./deck-membership";
import type {
  EditorialDeck,
  EditorialEntity,
  MembershipContext,
} from "./deck-membership";

export type FindingLevel = "blocking" | "warning";

export interface ValidationFinding {
  level: FindingLevel;
  code: string;
  message: string;
  subject: string;
}

export interface ValidationReport {
  validatedAt: string;
  blocking: number;
  warnings: number;
  findings: ValidationFinding[];
}

interface EditorialCatalogDocument {
  supportedLocales: string[];
  defaultLocale: string;
  entities: EditorialEntity[];
  decks: EditorialDeck[];
  additionalRelations?: {
    parentKey: string;
    childKey: string;
  }[];
  assetOverrides?: { entityKey: string; assetType?: string }[];
}

/**
 * What a template asks its question with, and what it can ask it about.
 *
 * A coat of arms is a country's, not a state's: a subdivision has a flag
 * and, so far, nothing else. Asking a template for a drawing an entity
 * cannot have is a mistake worth naming rather than an empty card
 * (ADR-020 §4.5).
 */
const CARD_TEMPLATES: Record<
  string,
  { promptAssetType: string; subjectTypes: Set<string> }
> = {
  FLAG_TO_COUNTRY: {
    promptAssetType: "flag",
    subjectTypes: new Set(["country", "territory", "area", "subdivision"]),
  },
  COAT_OF_ARMS_TO_COUNTRY: {
    promptAssetType: "coat_of_arms",
    subjectTypes: new Set(["country", "territory", "area"]),
  },
};

/** A deck's access as the active release publishes it. */
export interface PublishedDeckAccess {
  code: string;
  accessModel: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey: string | null;
}

const ADMINISTRATIVE_PARENT_TYPES = new Set(["country", "territory"]);

function blocking(
  code: string,
  subject: string,
  message: string,
): ValidationFinding {
  return { level: "blocking", code, subject, message };
}

function warning(
  code: string,
  subject: string,
  message: string,
): ValidationFinding {
  return { level: "warning", code, subject, message };
}

/**
 * The editorial rules a release build applies, run against a draft before
 * anyone proposes it.
 *
 * These are deliberately the rules that depend only on the editorial
 * document plus the active release's taxonomy — the ones an editor can
 * actually break and fix. Conflicts between upstream sources are found by
 * the build itself, which is the only place that has the pinned snapshots;
 * the report says so rather than pretending to cover them.
 *
 * `draft-validation.parity.spec.ts` pins the deck resolution used here to
 * the deck sizes the pipeline actually published, so a divergence between
 * this code and the build fails a test rather than a release.
 */
@Injectable()
export class DraftValidationService {
  validate(
    document: unknown,
    context: MembershipContext,
    draftAssets: {
      entityContentKey: string;
      assetType?: string;
      licenseName: string | null;
      sourceUrl: string | null;
      replacementReason: string | null;
    }[],
    publishedDecks: PublishedDeckAccess[] = [],
  ): ValidationReport {
    const catalog = document as EditorialCatalogDocument;
    const findings: ValidationFinding[] = [
      ...this.entityFindings(catalog),
      ...this.subdivisionFindings(catalog),
      ...this.deckFindings(catalog, context),
      ...this.cardFindings(catalog, draftAssets),
      ...this.accessFindings(catalog, publishedDecks),
      ...this.relationFindings(catalog),
      ...this.assetFindings(catalog, draftAssets),
    ];

    return {
      validatedAt: new Date().toISOString(),
      blocking: findings.filter((finding) => finding.level === "blocking")
        .length,
      warnings: findings.filter((finding) => finding.level === "warning")
        .length,
      findings,
    };
  }

  private entityFindings(
    catalog: EditorialCatalogDocument,
  ): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const seen = new Set<string>();
    for (const entity of catalog.entities) {
      if (seen.has(entity.key)) {
        findings.push(
          blocking(
            "ENTITY_DUPLICATE",
            entity.key,
            "The catalog lists this entity more than once",
          ),
        );
      }
      seen.add(entity.key);
    }
    if (currentEntityKeys(catalog.entities).length === 0) {
      findings.push(
        blocking(
          "CATALOG_EMPTY",
          "catalog",
          "No entity is both approved and current, so a release would teach nothing",
        ),
      );
    }
    return findings;
  }

  private deckFindings(
    catalog: EditorialCatalogDocument,
    context: MembershipContext,
  ): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const keys = new Set<string>();
    for (const deck of catalog.decks) {
      if (keys.has(deck.key)) {
        findings.push(
          blocking(
            "DECK_DUPLICATE",
            deck.key,
            "The catalog lists this deck more than once",
          ),
        );
      }
      keys.add(deck.key);

      for (const locale of catalog.supportedLocales) {
        const localized = deck.names[locale];
        if (
          localized === undefined ||
          localized.name.trim().length === 0 ||
          localized.description.trim().length === 0
        ) {
          findings.push(
            blocking(
              "DECK_LOCALIZATION_MISSING",
              deck.key,
              `The deck has no name or description for ${locale}`,
            ),
          );
        }
      }

      // A member outside the learnable pool has no card: the client
      // skips it silently, so the deck teaches less than the list says —
      // or nothing at all, as a deck of regions would (ADR-015).
      if (membersMode(deck.members) === "explicit") {
        const learnableByKey = new Map(
          catalog.entities.map((entity) => [entity.key, isLearnable(entity)]),
        );
        for (const memberKey of deck.members as string[]) {
          const learnable = learnableByKey.get(memberKey);
          if (learnable === undefined) {
            findings.push(
              warning(
                "MEMBER_UNKNOWN",
                deck.key,
                `The deck lists ${memberKey}, which the catalog does not carry`,
              ),
            );
          } else if (!learnable) {
            findings.push(
              warning(
                "MEMBER_NOT_LEARNABLE",
                deck.key,
                `${memberKey} carries no learning card, so the deck will publish without it`,
              ),
            );
          }
        }
      }

      try {
        const members = resolveDeckMembers(deck, context);
        if (members.length === 0) {
          findings.push(
            blocking(
              "DECK_EMPTY",
              deck.key,
              "The deck resolves to no country and would publish empty",
            ),
          );
        } else if (
          members.length < 5 &&
          membersMode(deck.members) !== "explicit"
        ) {
          findings.push(
            warning(
              "DECK_SMALL",
              deck.key,
              `The deck resolves to only ${String(members.length)} countries`,
            ),
          );
        }
      } catch {
        // Only the release build classifies against freshly merged sources;
        // this preview sees the active release's taxonomy, which is one
        // refresh behind. A node the preview cannot walk may well resolve at
        // build time, so this warns rather than blocking legitimate work —
        // an explicit list, which needs no taxonomy at all, is checked
        // above and does block.
        findings.push(
          warning(
            "DECK_UNRESOLVABLE_HERE",
            deck.key,
            "This preview cannot resolve the deck against the active release's taxonomy; the release build resolves it against freshly merged sources",
          ),
        );
      }
    }
    return findings;
  }

  /**
   * What has to be true of a state before it can be published.
   *
   * A subdivision sits in the same catalog as a country, so nothing but
   * these rules stops it from behaving like one: appearing in the
   * all-countries deck, floating with no country above it, or belonging to
   * something that is not a country at all (ADR-020).
   */
  private subdivisionFindings(
    catalog: EditorialCatalogDocument,
  ): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const byKey = new Map(
      catalog.entities.map((entity) => [entity.key, entity]),
    );

    for (const entity of catalog.entities) {
      if (entity.type !== "subdivision") {
        if (
          entity.parentKey !== undefined &&
          entity.parentKey !== null &&
          entity.parentKey !== ""
        ) {
          findings.push(
            blocking(
              "SUBDIVISION_PARENT_INVALID",
              entity.key,
              `Only a subdivision belongs to another entity; ${entity.type} ${entity.key} names ${entity.parentKey} as its parent`,
            ),
          );
        }
        continue;
      }

      if (entity.config.includeInCountryCatalog) {
        findings.push(
          blocking(
            "SUBDIVISION_IN_COUNTRY_CATALOG",
            entity.key,
            "A state is not a country and must stay out of the all-countries deck",
          ),
        );
      }

      const parentKey = entity.parentKey;
      if (parentKey === undefined || parentKey === null || parentKey === "") {
        findings.push(
          blocking(
            "SUBDIVISION_PARENT_REQUIRED",
            entity.key,
            "A subdivision belongs to a country; name the one it is part of",
          ),
        );
        continue;
      }
      const parent = byKey.get(parentKey);
      if (parent === undefined) {
        findings.push(
          blocking(
            "SUBDIVISION_PARENT_INVALID",
            entity.key,
            `The catalog does not carry ${parentKey}`,
          ),
        );
        continue;
      }
      if (!ADMINISTRATIVE_PARENT_TYPES.has(parent.type)) {
        findings.push(
          blocking(
            "SUBDIVISION_PARENT_INVALID",
            entity.key,
            `${parentKey} is a ${parent.type}; a subdivision belongs to a country or a territory`,
          ),
        );
      }
    }

    findings.push(...this.administrativeCycleFindings(byKey));
    return findings;
  }

  /**
   * A unit cannot contain the country that contains it.
   *
   * The walk is bounded by the catalog, so a cycle is reported rather than
   * followed: publishing one would hang every reader that asks what a
   * subdivision belongs to.
   */
  private administrativeCycleFindings(
    byKey: Map<string, EditorialEntity>,
  ): ValidationFinding[] {
    const reported = new Set<string>();
    const findings: ValidationFinding[] = [];
    for (const entity of byKey.values()) {
      const seen = new Set<string>([entity.key]);
      let current: EditorialEntity | undefined = entity;
      while (current?.parentKey !== undefined && current.parentKey !== null) {
        const parentKey: string = current.parentKey;
        if (seen.has(parentKey)) {
          if (!reported.has(parentKey)) {
            reported.add(parentKey);
            findings.push(
              blocking(
                "ADMINISTRATIVE_RELATION_CYCLE",
                parentKey,
                "The administrative parents form a cycle",
              ),
            );
          }
          break;
        }
        seen.add(parentKey);
        current = byKey.get(parentKey);
      }
    }
    return findings;
  }

  /**
   * Whether every card a deck asks for can exist.
   *
   * A member names a template as well as an entity, and the publisher
   * resolves it by that name: one that resolves to nothing drops out of the
   * deck without a word, which is how a deck of fifty states could be
   * released holding thirty.
   */
  private cardFindings(
    catalog: EditorialCatalogDocument,
    draftAssets: { entityContentKey: string; assetType?: string }[],
  ): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const entityByKey = new Map(
      catalog.entities.map((entity) => [entity.key, entity]),
    );
    // What a drawing of this type exists for, as far as the draft can see:
    // an upload in this draft, or an editorial override the catalog carries.
    const drawings = new Set<string>();
    for (const asset of draftAssets) {
      drawings.add(`${asset.entityContentKey}#${asset.assetType ?? "flag"}`);
    }
    for (const override of catalog.assetOverrides ?? []) {
      drawings.add(`${override.entityKey}#${override.assetType ?? "flag"}`);
    }

    for (const deck of catalog.decks) {
      if (!Array.isArray(deck.members)) {
        continue;
      }
      const seen = new Set<string>();
      for (const member of deck.members) {
        const ref = memberCardRef(deck, member);
        const identity = `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
        if (seen.has(identity)) {
          findings.push(
            blocking(
              "DECK_CARD_DUPLICATE",
              deck.key,
              `The deck holds ${identity} twice`,
            ),
          );
        }
        seen.add(identity);

        const template = CARD_TEMPLATES[ref.templateCode];
        if (template === undefined) {
          findings.push(
            blocking(
              "CARD_TEMPLATE_UNKNOWN",
              deck.key,
              `No release publishes a ${ref.templateCode} card`,
            ),
          );
          continue;
        }
        const entity = entityByKey.get(ref.entityKey);
        if (entity === undefined) {
          // Reported as an unknown member by the deck rules above.
          continue;
        }
        if (!isLearnable(entity) && entity.type !== "subdivision") {
          // An entity that carries no card at all — a region, a retired
          // country — is already a warning above, and deliberately not a
          // blocker: the build publishes the deck without it. This rule is
          // about a template the subject cannot carry, not about a member
          // that was never a card.
          continue;
        }
        if (!template.subjectTypes.has(entity.type)) {
          findings.push(
            blocking(
              "CARD_TEMPLATE_SUBJECT_KIND_UNSUPPORTED",
              deck.key,
              `${ref.templateCode} does not teach a ${entity.type}; ${ref.entityKey} cannot carry that card`,
            ),
          );
          continue;
        }
        // A flag comes from the sources for anything the catalog teaches;
        // any other symbol exists only because somebody uploaded it, so
        // that is the one the preview can check.
        if (
          template.promptAssetType !== "flag" &&
          !drawings.has(`${ref.entityKey}#${template.promptAssetType}`)
        ) {
          findings.push(
            blocking(
              "CARD_TEMPLATE_ASSET_MISSING",
              deck.key,
              `${ref.entityKey} has no ${template.promptAssetType} for its ${ref.templateCode} card`,
            ),
          );
        }
      }

      for (const preview of deck.previewCards ?? []) {
        const ref = memberCardRef(deck, preview);
        const identity = `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
        if (!seen.has(identity)) {
          findings.push(
            blocking(
              "DECK_PREVIEW_NOT_MEMBER",
              deck.key,
              `The deck previews ${identity}, which it does not hold`,
            ),
          );
        }
      }
      if ((deck.previewCards ?? []).length > 3) {
        findings.push(
          blocking(
            "DECK_PREVIEW_NOT_PUBLIC",
            deck.key,
            "A locked deck may show at most three cards before it is bought",
          ),
        );
      }
    }
    return findings;
  }

  /**
   * What a paid deck may and may not become.
   *
   * Taking access away from somebody who paid is the one editorial mistake
   * that cannot be undone by publishing again, so a free deck that has
   * already shipped cannot quietly become a paid one: that needs a new deck
   * or an approved migration (ADR-019).
   */
  private accessFindings(
    catalog: EditorialCatalogDocument,
    publishedDecks: PublishedDeckAccess[],
  ): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const publishedByCode = new Map(
      publishedDecks.map((deck) => [deck.code, deck]),
    );

    for (const deck of catalog.decks) {
      const access = deck.access;
      if (access === undefined) {
        continue;
      }
      const key = access.requiredEntitlementKey;
      if (
        access.model === "ENTITLEMENT" &&
        (key === undefined || key === null || key.trim().length === 0)
      ) {
        findings.push(
          blocking(
            "DECK_ACCESS_ENTITLEMENT_MISSING",
            deck.key,
            "A paid deck needs the entitlement that opens it",
          ),
        );
      }
      if (
        access.model === "FREE" &&
        key !== undefined &&
        key !== null &&
        key.trim().length > 0
      ) {
        findings.push(
          blocking(
            "DECK_ACCESS_ENTITLEMENT_UNUSED",
            deck.key,
            "A free deck must not name an entitlement",
          ),
        );
      }

      const published = publishedByCode.get(deckCodeFromKey(deck.key));
      if (published === undefined) {
        continue;
      }
      if (published.accessModel === "FREE" && access.model === "ENTITLEMENT") {
        findings.push(
          blocking(
            "DECK_ACCESS_TIGHTENED",
            deck.key,
            "This deck is published free; making it paid would take it away from everyone who has it. Publish a new deck, or run an approved migration",
          ),
        );
      }
      if (
        published.accessModel === "ENTITLEMENT" &&
        access.model === "ENTITLEMENT" &&
        published.requiredEntitlementKey !== null &&
        key !== published.requiredEntitlementKey
      ) {
        findings.push(
          blocking(
            "DECK_ENTITLEMENT_CHANGED",
            deck.key,
            `This deck is published against ${published.requiredEntitlementKey}; changing the entitlement is a migration, not an edit`,
          ),
        );
      }
      if (published.accessModel === "ENTITLEMENT" && access.model === "FREE") {
        findings.push(
          warning(
            "DECK_ACCESS_RELAXED",
            deck.key,
            "This deck is published as paid; making it free does not refund anyone who bought it",
          ),
        );
      }
    }

    // A paid deck that simply disappears leaves its owners with nothing.
    const draftCodes = new Set(
      catalog.decks.map((deck) => deckCodeFromKey(deck.key)),
    );
    for (const published of publishedDecks) {
      if (
        published.accessModel === "ENTITLEMENT" &&
        !draftCodes.has(published.code)
      ) {
        findings.push(
          blocking(
            "PAID_DECK_REMOVED",
            published.code,
            "A paid deck cannot be dropped from the catalog while somebody owns it; take it off sale instead",
          ),
        );
      }
    }
    return findings;
  }

  private relationFindings(
    catalog: EditorialCatalogDocument,
  ): ValidationFinding[] {
    const known = new Set(catalog.entities.map((entity) => entity.key));
    return (catalog.additionalRelations ?? []).flatMap((relation) => {
      const findings: ValidationFinding[] = [];
      for (const key of [relation.parentKey, relation.childKey]) {
        if (!known.has(key)) {
          findings.push(
            warning(
              "RELATION_UNKNOWN_ENTITY",
              key,
              "An editorial relation names an entity the catalog does not carry; the build resolves it from the sources or drops it",
            ),
          );
        }
      }
      return findings;
    });
  }

  private assetFindings(
    catalog: EditorialCatalogDocument,
    draftAssets: {
      entityContentKey: string;
      licenseName: string | null;
      sourceUrl: string | null;
      replacementReason: string | null;
    }[],
  ): ValidationFinding[] {
    const known = new Set(catalog.entities.map((entity) => entity.key));
    return draftAssets.flatMap((asset) => {
      const findings: ValidationFinding[] = [];
      if (!known.has(asset.entityContentKey)) {
        findings.push(
          blocking(
            "ASSET_UNKNOWN_ENTITY",
            asset.entityContentKey,
            "An uploaded asset names an entity the catalog does not carry",
          ),
        );
      }
      // A published asset nobody can account for is worse than no asset, so
      // provenance is blocking rather than advisory.
      if (
        asset.licenseName === null ||
        asset.sourceUrl === null ||
        asset.replacementReason === null
      ) {
        findings.push(
          blocking(
            "ASSET_PROVENANCE_INCOMPLETE",
            asset.entityContentKey,
            "The uploaded asset is missing its license, source or replacement reason",
          ),
        );
      }
      return findings;
    });
  }
}
