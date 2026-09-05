import { Injectable } from "@nestjs/common";

import { deckCodeFromKey } from "../content/bundle/bundle-mapper";

import {
  currentEntityKeys,
  isLearnable,
  memberCardRef,
  memberEntityKey,
  membersMode,
  resolveDeckMembers,
} from "./deck-membership";
import type {
  DeckCardRef,
  EditorialDeck,
  EditorialEntity,
  MembershipContext,
} from "./deck-membership";

export type FindingLevel = "blocking" | "warning";

/** What kind of thing a finding is about. */
export type FindingObjectType =
  | "catalog"
  | "entity"
  | "deck"
  | "asset"
  | "relation";

/**
 * Where a finding lives, precisely enough for a click to open it.
 *
 * A report that only says "something is wrong with deck.european_coats" makes
 * the reader go and find the field themselves, which is exactly the work the
 * console exists to save (docs/19-admin-redesign.md §9). So a finding names
 * the object, the tab of that object's editor, and a JSON Pointer into the
 * object as *this API returns it* — `/parentKey` on an entity, `/members/3`
 * on a deck — rather than into the editorial document, which the console
 * never sees.
 */
export interface FindingTarget {
  objectType: FindingObjectType;
  /** The key of the object, identical to the finding's `subject`. */
  objectKey: string;
  /** The editor tab the field is on, null when the object has no tabs. */
  tab: string | null;
  /** RFC 6901 pointer into the object's edit model, null when it is the whole object. */
  field: string | null;
}

export interface ValidationFinding {
  /** The severity: `blocking` stops a release, `warning` does not. */
  level: FindingLevel;
  code: string;
  message: string;
  subject: string;
  target: FindingTarget;
  /**
   * The admin console route that opens the object, filled in where the draft
   * is known. The validator itself is given a document, not a draft id.
   */
  route?: string;
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

/** The tabs of the entity editor, as the console routes them. */
type EntityTab = "overview" | "names" | "facts" | "media" | "usage";
/** The tabs of the deck builder. */
type DeckTab = "details" | "content" | "presentation" | "access" | "review";

function entityTarget(
  key: string,
  tab: EntityTab,
  field: string | null = null,
): FindingTarget {
  return { objectType: "entity", objectKey: key, tab, field };
}

function deckTarget(
  key: string,
  tab: DeckTab,
  field: string | null = null,
): FindingTarget {
  return { objectType: "deck", objectKey: key, tab, field };
}

function assetTarget(
  entityKey: string,
  field: string | null = null,
): FindingTarget {
  // A draft asset is edited on the entity that owns it: the media editor is
  // contextual, and there is no screen where an asset floats free (§7.1).
  return { objectType: "asset", objectKey: entityKey, tab: "media", field };
}

function catalogTarget(field: string | null = null): FindingTarget {
  return { objectType: "catalog", objectKey: "catalog", tab: null, field };
}

function relationTarget(key: string): FindingTarget {
  return {
    objectType: "relation",
    objectKey: key,
    tab: null,
    field: "/additionalRelations",
  };
}

function blocking(
  code: string,
  target: FindingTarget,
  message: string,
): ValidationFinding {
  return {
    level: "blocking",
    code,
    subject: target.objectKey,
    message,
    target,
  };
}

function warning(
  code: string,
  target: FindingTarget,
  message: string,
): ValidationFinding {
  return { level: "warning", code, subject: target.objectKey, message, target };
}

/**
 * The console route that opens a finding's object.
 *
 * The validator judges a document and has no draft id, so the route is added
 * where the draft is known. Keeping it out of the rules means a finding can
 * be produced for a document that is not stored yet — a preview, a test —
 * without inventing a URL for it.
 */
export function routeOfFinding(draftId: string, target: FindingTarget): string {
  const base = `/drafts/${encodeURIComponent(draftId)}`;
  switch (target.objectType) {
    case "entity":
    case "asset":
      return `${base}/entities/${encodeURIComponent(target.objectKey)}`;
    case "deck":
      return `${base}/decks/${encodeURIComponent(target.objectKey)}`;
    default:
      return base;
  }
}

/** The same report, with every finding pointing at a route in this draft. */
export function withFindingRoutes(
  report: ValidationReport,
  draftId: string,
): ValidationReport {
  return {
    ...report,
    findings: report.findings.map((finding) => ({
      ...finding,
      route: routeOfFinding(draftId, finding.target),
    })),
  };
}

/** The index of a member in the deck's own `members` array, for the pointer. */
function memberPointer(index: number): string {
  return `/members/${String(index)}`;
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
            entityTarget(entity.key, "overview", "/key"),
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
          catalogTarget("/entities"),
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
            deckTarget(deck.key, "details", "/key"),
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
              deckTarget(deck.key, "details", `/names/${locale}/name`),
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
        const members = deck.members as DeckCardRef[];
        members.forEach((member, index) => {
          // A member may be written as a bare key or as a card ref; both name
          // one entity, and reading the object as a key would report the
          // catalog as missing `[object Object]`.
          const memberKey = memberEntityKey(member);
          const learnable = learnableByKey.get(memberKey);
          if (learnable === undefined) {
            findings.push(
              warning(
                "MEMBER_UNKNOWN",
                deckTarget(deck.key, "content", memberPointer(index)),
                `The deck lists ${memberKey}, which the catalog does not carry`,
              ),
            );
          } else if (!learnable) {
            findings.push(
              warning(
                "MEMBER_NOT_LEARNABLE",
                deckTarget(deck.key, "content", memberPointer(index)),
                `${memberKey} carries no learning card, so the deck will publish without it`,
              ),
            );
          }
        });
      }

      try {
        const members = resolveDeckMembers(deck, context);
        if (members.length === 0) {
          findings.push(
            blocking(
              "DECK_EMPTY",
              deckTarget(deck.key, "content", "/members"),
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
              deckTarget(deck.key, "content", "/members"),
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
            deckTarget(deck.key, "content", "/members"),
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
              entityTarget(entity.key, "overview", "/parentKey"),
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
            entityTarget(entity.key, "overview", "/includeInCountryCatalog"),
            "A state is not a country and must stay out of the all-countries deck",
          ),
        );
      }

      const parentKey = entity.parentKey;
      if (parentKey === undefined || parentKey === null || parentKey === "") {
        findings.push(
          blocking(
            "SUBDIVISION_PARENT_REQUIRED",
            entityTarget(entity.key, "overview", "/parentKey"),
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
            entityTarget(entity.key, "overview", "/parentKey"),
            `The catalog does not carry ${parentKey}`,
          ),
        );
        continue;
      }
      if (!ADMINISTRATIVE_PARENT_TYPES.has(parent.type)) {
        findings.push(
          blocking(
            "SUBDIVISION_PARENT_INVALID",
            entityTarget(entity.key, "overview", "/parentKey"),
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
                entityTarget(parentKey, "overview", "/parentKey"),
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
      deck.members.forEach((member, index) => {
        const ref = memberCardRef(deck, member);
        const identity = `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
        if (seen.has(identity)) {
          findings.push(
            blocking(
              "DECK_CARD_DUPLICATE",
              deckTarget(deck.key, "content", memberPointer(index)),
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
              deckTarget(deck.key, "content", memberPointer(index)),
              `No release publishes a ${ref.templateCode} card`,
            ),
          );
          return;
        }
        const entity = entityByKey.get(ref.entityKey);
        if (entity === undefined) {
          // Reported as an unknown member by the deck rules above.
          return;
        }
        if (!isLearnable(entity) && entity.type !== "subdivision") {
          // An entity that carries no card at all — a region, a retired
          // country — is already a warning above, and deliberately not a
          // blocker: the build publishes the deck without it. This rule is
          // about a template the subject cannot carry, not about a member
          // that was never a card.
          return;
        }
        if (!template.subjectTypes.has(entity.type)) {
          findings.push(
            blocking(
              "CARD_TEMPLATE_SUBJECT_KIND_UNSUPPORTED",
              deckTarget(deck.key, "content", memberPointer(index)),
              `${ref.templateCode} does not teach a ${entity.type}; ${ref.entityKey} cannot carry that card`,
            ),
          );
          return;
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
              deckTarget(deck.key, "content", memberPointer(index)),
              `${ref.entityKey} has no ${template.promptAssetType} for its ${ref.templateCode} card`,
            ),
          );
        }
      });

      (deck.previewCards ?? []).forEach((preview, index) => {
        const ref = memberCardRef(deck, preview);
        const identity = `${ref.entityKey}#${ref.templateCode}@${String(ref.templateSchemaVersion)}`;
        if (!seen.has(identity)) {
          findings.push(
            blocking(
              "DECK_PREVIEW_NOT_MEMBER",
              deckTarget(
                deck.key,
                "presentation",
                `/previewCardIds/${String(index)}`,
              ),
              `The deck previews ${identity}, which it does not hold`,
            ),
          );
        }
      });
      if ((deck.previewCards ?? []).length > 3) {
        findings.push(
          blocking(
            "DECK_PREVIEW_NOT_PUBLIC",
            deckTarget(deck.key, "presentation", "/previewCardIds"),
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
            deckTarget(deck.key, "access", "/access/requiredEntitlementKey"),
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
            deckTarget(deck.key, "access", "/access/requiredEntitlementKey"),
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
            deckTarget(deck.key, "access", "/access/model"),
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
            deckTarget(deck.key, "access", "/access/requiredEntitlementKey"),
            `This deck is published against ${published.requiredEntitlementKey}; changing the entitlement is a migration, not an edit`,
          ),
        );
      }
      if (published.accessModel === "ENTITLEMENT" && access.model === "FREE") {
        findings.push(
          warning(
            "DECK_ACCESS_RELAXED",
            deckTarget(deck.key, "access", "/access/model"),
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
            // The deck is gone from the draft, so there is no editor to open:
            // the catalog is where it has to come back.
            catalogTarget("/decks"),
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
              relationTarget(key),
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
            assetTarget(asset.entityContentKey),
            "An uploaded asset names an entity the catalog does not carry",
          ),
        );
      }
      // A published asset nobody can account for is worse than no asset, so
      // provenance is blocking rather than advisory. The pointer names the
      // first field that is missing, so the click lands on something to type
      // into rather than on the form in general.
      const missing = (
        [
          ["licenseName", asset.licenseName],
          ["sourceUrl", asset.sourceUrl],
          ["replacementReason", asset.replacementReason],
        ] as const
      ).find(([, value]) => value === null);
      if (missing !== undefined) {
        findings.push(
          blocking(
            "ASSET_PROVENANCE_INCOMPLETE",
            assetTarget(asset.entityContentKey, `/${missing[0]}`),
            "The uploaded asset is missing its license, source or replacement reason",
          ),
        );
      }
      return findings;
    });
  }
}
