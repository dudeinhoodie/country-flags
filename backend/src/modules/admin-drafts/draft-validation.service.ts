import { Injectable } from "@nestjs/common";

import {
  currentEntityKeys,
  isLearnable,
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
  assetOverrides?: { entityKey: string }[];
}

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
      licenseName: string | null;
      sourceUrl: string | null;
      replacementReason: string | null;
    }[],
  ): ValidationReport {
    const catalog = document as EditorialCatalogDocument;
    const findings: ValidationFinding[] = [
      ...this.entityFindings(catalog),
      ...this.deckFindings(catalog, context),
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
