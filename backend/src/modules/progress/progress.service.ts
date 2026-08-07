import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AchievementScopeType,
  CardStatus,
  DeckStatus,
  GeoEntityKind,
  GeoEntityStatus,
  GeoRelationType,
  MasteryTier,
  type Prisma,
} from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  aggregateProgress,
  type MasteryThreshold,
  masteryTierRank,
  type ProgressAggregate,
  type ProgressCardMetrics,
} from "./mastery-rules";

type Transaction = Prisma.TransactionClient;

interface ScopeProgress extends ProgressAggregate {
  scopeType: "DECK" | "REGION";
  scopeId: string;
}

interface ProgressSnapshot {
  cards: ProgressCardMetrics[];
  decks: ScopeProgress[];
  regions: ScopeProgress[];
}

export interface ProgressRebuildResult {
  account: Record<string, unknown>;
  decks: Record<string, unknown>[];
  regions: Record<string, unknown>[];
  newAchievements: Record<string, unknown>[];
}

function grantKey(input: {
  definitionId: string;
  scopeType: AchievementScopeType;
  scopeId: string | null;
}): string {
  return `${input.definitionId}:${input.scopeType}:${input.scopeId ?? "GLOBAL"}`;
}

function highestTier(tiers: Array<MasteryTier | null>): MasteryTier {
  return tiers.reduce<MasteryTier>(
    (highest, tier) =>
      tier !== null && masteryTierRank(tier) > masteryTierRank(highest)
        ? tier
        : highest,
    MasteryTier.NONE,
  );
}

function progressResponse(
  aggregate: ProgressAggregate,
  highestAchievementTier: MasteryTier,
): Record<string, unknown> {
  return {
    totalCards: aggregate.totalCards,
    learnedCards: aggregate.learnedCards,
    dueCards: aggregate.dueCards,
    overdueCards: aggregate.overdueCards,
    dueLearningCards: aggregate.dueLearningCards,
    dueRelearningCards: aggregate.dueRelearningCards,
    newCards: aggregate.newCards,
    learningCards: aggregate.learningCards,
    relearningCards: aggregate.relearningCards,
    reviewCards: aggregate.reviewCards,
    successfulReviews: aggregate.successfulReviews,
    reviewCount: aggregate.reviewCount,
    accuracy30Days: aggregate.accuracy30Days,
    currentMasteryTier: aggregate.currentMasteryTier,
    highestAchievementTier,
    ruleVersion: aggregate.ruleVersion,
  };
}

function scopeResponse(
  scope: ScopeProgress,
  highestAchievementTier: MasteryTier,
  updatedAt: Date,
): Record<string, unknown> {
  return {
    [`${scope.scopeType.toLowerCase()}Id`]: scope.scopeId,
    ...progressResponse(scope, highestAchievementTier),
    updatedAt: updatedAt.toISOString(),
  };
}

function achievementResponse(achievement: {
  id: string;
  scopeType: AchievementScopeType;
  scopeId: string | null;
  earnedAt: Date;
  ruleVersion: number;
  evidence: Prisma.JsonValue;
  definition: {
    code: string;
    category: string;
    tier: MasteryTier | null;
  };
}): Record<string, unknown> {
  return {
    id: achievement.id,
    code: achievement.definition.code,
    category: achievement.definition.category,
    // An untiered achievement omits the field; the contract types it as the
    // MasteryTier enum so generated clients keep it.
    ...(achievement.definition.tier === null
      ? {}
      : { tier: achievement.definition.tier }),
    scopeType: achievement.scopeType,
    scopeId: achievement.scopeId,
    earned: true,
    earnedAt: achievement.earnedAt.toISOString(),
    ruleVersion: achievement.ruleVersion,
    evidence: achievement.evidence,
  };
}

function masteryThresholds(
  definitions: Array<{
    tier: MasteryTier | null;
    ruleVersion: number;
    ruleSpec: Prisma.JsonValue;
  }>,
): { ruleVersion: number; thresholds: MasteryThreshold[] } {
  const ruleVersion = definitions.reduce(
    (latest, definition) => Math.max(latest, definition.ruleVersion),
    0,
  );
  const current = definitions.filter(
    (definition) => definition.ruleVersion === ruleVersion,
  );
  const thresholds = current.map((definition) => {
    const rule = definition.ruleSpec;
    if (
      definition.tier === null ||
      typeof rule !== "object" ||
      rule === null ||
      Array.isArray(rule) ||
      typeof rule.coverage !== "number" ||
      typeof rule.successfulReviewsPerCard !== "number" ||
      typeof rule.accuracy30Days !== "number" ||
      typeof rule.minimumSuccessfulReviews !== "number" ||
      typeof rule.maximumOverdueRatio !== "number"
    ) {
      throw new ServiceUnavailableException(
        "Active mastery definition is invalid",
      );
    }
    return {
      tier: definition.tier as Exclude<MasteryTier, "NONE">,
      coverage: rule.coverage,
      successfulReviewsPerCard: rule.successfulReviewsPerCard,
      accuracy30Days: rule.accuracy30Days,
      minimumSuccessfulReviews: rule.minimumSuccessfulReviews,
      maximumOverdueRatio: rule.maximumOverdueRatio,
    };
  });
  if (ruleVersion < 1 || thresholds.length !== 4) {
    throw new ServiceUnavailableException(
      "No complete active mastery rule is available",
    );
  }
  return {
    ruleVersion,
    thresholds: thresholds.sort(
      (left, right) => masteryTierRank(left.tier) - masteryTierRank(right.tier),
    ),
  };
}

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async rebuildUser(
    userId: string,
    now = new Date(),
  ): Promise<ProgressRebuildResult> {
    return this.prisma.$transaction(async (transaction) => {
      const activeDefinitions =
        await transaction.achievementDefinition.findMany({
          where: {
            tier: { not: null },
            activeFrom: { lte: now },
            OR: [{ activeTo: null }, { activeTo: { gt: now } }],
          },
          orderBy: [{ ruleVersion: "desc" }, { code: "asc" }],
        });
      const rule = masteryThresholds(activeDefinitions);
      const definitions = activeDefinitions.filter(
        ({ ruleVersion }) => ruleVersion === rule.ruleVersion,
      );
      const snapshot = await this.loadSnapshot(
        transaction,
        userId,
        now,
        rule.thresholds,
        rule.ruleVersion,
      );
      const publishedDeckIds = snapshot.decks.map(({ scopeId }) => scopeId);
      await transaction.userDeckMastery.deleteMany({
        where: {
          userId,
          ...(publishedDeckIds.length === 0
            ? {}
            : { deckId: { notIn: publishedDeckIds } }),
        },
      });
      for (const deck of snapshot.decks) {
        await transaction.userDeckMastery.upsert({
          where: { userId_deckId: { userId, deckId: deck.scopeId } },
          create: {
            userId,
            deckId: deck.scopeId,
            tier: deck.currentMasteryTier,
            masteredCardCount: deck.learnedCards,
            totalCardCount: deck.totalCards,
            projectionVersion: deck.ruleVersion,
          },
          update: {
            tier: deck.currentMasteryTier,
            masteredCardCount: deck.learnedCards,
            totalCardCount: deck.totalCards,
            projectionVersion: deck.ruleVersion,
          },
        });
      }

      const existing = await transaction.userAchievement.findMany({
        where: { userId },
        select: { definitionId: true, scopeType: true, scopeId: true },
      });
      const existingKeys = new Set(existing.map(grantKey));
      const scopes = [...snapshot.decks, ...snapshot.regions];
      const grants: Prisma.UserAchievementCreateManyInput[] = [];
      for (const scope of scopes) {
        for (const definition of definitions) {
          if (
            definition.tier === null ||
            masteryTierRank(scope.currentMasteryTier) <
              masteryTierRank(definition.tier)
          ) {
            continue;
          }
          grants.push({
            userId,
            definitionId: definition.id,
            scopeType:
              scope.scopeType === "DECK"
                ? AchievementScopeType.DECK
                : AchievementScopeType.REGION,
            scopeId: scope.scopeId,
            earnedAt: now,
            ruleVersion: definition.ruleVersion,
            evidence: {
              tier: definition.tier,
              totalCards: scope.totalCards,
              learnedCards: scope.learnedCards,
              successfulReviews: scope.successfulReviews,
              reviewCount: scope.reviewCount,
              accuracy30Days: scope.accuracy30Days,
              dueCards: scope.dueCards,
              masteryRuleVersion: scope.ruleVersion,
            },
          });
        }
      }
      if (grants.length > 0) {
        await transaction.userAchievement.createMany({
          data: grants,
          skipDuplicates: true,
        });
      }
      const achievements = await transaction.userAchievement.findMany({
        where: { userId },
        include: { definition: true },
        orderBy: [{ earnedAt: "asc" }, { id: "asc" }],
      });
      const tiersByScope = new Map<string, MasteryTier[]>();
      for (const achievement of achievements) {
        const key = `${achievement.scopeType}:${achievement.scopeId ?? "GLOBAL"}`;
        const tiers = tiersByScope.get(key) ?? [];
        tiers.push(achievement.definition.tier ?? MasteryTier.NONE);
        tiersByScope.set(key, tiers);
      }
      const deckResponses = snapshot.decks.map((deck) =>
        scopeResponse(
          deck,
          highestTier(tiersByScope.get(`DECK:${deck.scopeId}`) ?? []),
          now,
        ),
      );
      const regionResponses = snapshot.regions.map((region) =>
        scopeResponse(
          region,
          highestTier(tiersByScope.get(`REGION:${region.scopeId}`) ?? []),
          now,
        ),
      );
      const accountAggregate = aggregateProgress(
        snapshot.cards,
        now,
        rule.thresholds,
        rule.ruleVersion,
      );

      return {
        account: {
          ...progressResponse(
            accountAggregate,
            highestTier(achievements.map(({ definition }) => definition.tier)),
          ),
          decks: deckResponses,
          regions: regionResponses,
          updatedAt: now.toISOString(),
        },
        decks: deckResponses,
        regions: regionResponses,
        newAchievements: achievements
          .filter((achievement) => !existingKeys.has(grantKey(achievement)))
          .map(achievementResponse),
      };
    });
  }

  async getDueSummary(userId: string): Promise<Record<string, unknown>> {
    const rebuilt = await this.rebuildUser(userId);
    const account = rebuilt.account as {
      dueCards: number;
      overdueCards: number;
      dueLearningCards: number;
      dueRelearningCards: number;
      newCards: number;
      learningCards: number;
      relearningCards: number;
      reviewCards: number;
      updatedAt: string;
    };
    return {
      overdue: account.overdueCards,
      learning: account.dueLearningCards,
      relearning: account.dueRelearningCards,
      newCards: account.newCards,
      review: account.reviewCards,
      totalDue: account.dueCards,
      serverTime: account.updatedAt,
    };
  }

  async getProgress(userId: string): Promise<Record<string, unknown>> {
    return (await this.rebuildUser(userId)).account;
  }

  async getDeckProgress(
    userId: string,
    deckId: string,
  ): Promise<Record<string, unknown>> {
    const deck = (await this.rebuildUser(userId)).decks.find(
      (item) => item.deckId === deckId,
    );
    if (deck === undefined) {
      throw new NotFoundException("Deck was not found");
    }
    return deck;
  }

  async listAchievements(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Record<string, unknown>> {
    await this.rebuildUser(userId);
    const afterId = cursor === undefined ? null : this.decodeCursor(cursor);
    const rows = await this.prisma.userAchievement.findMany({
      where: {
        userId,
        ...(afterId === null ? {} : { id: { gt: afterId } }),
      },
      include: { definition: true },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(achievementResponse),
      page: {
        nextCursor:
          hasMore && last !== undefined
            ? Buffer.from(
                JSON.stringify({ kind: "achievement", id: last.id }),
              ).toString("base64url")
            : null,
        hasMore,
      },
    };
  }

  private decodeCursor(cursor: string): string {
    try {
      const value = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      ) as unknown;
      if (
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        value.kind === "achievement" &&
        "id" in value &&
        typeof value.id === "string"
      ) {
        return value.id;
      }
    } catch {
      // The common error envelope is produced by the controller filter.
    }
    throw new BadRequestException("Achievement cursor is invalid");
  }

  private async loadSnapshot(
    transaction: Transaction,
    userId: string,
    now: Date,
    thresholds: readonly MasteryThreshold[],
    ruleVersion: number,
  ): Promise<ProgressSnapshot> {
    const cards = await transaction.learningCard.findMany({
      where: { status: CardStatus.ACTIVE },
      select: {
        id: true,
        userStates: { where: { userId }, take: 1 },
      },
      orderBy: { id: "asc" },
    });
    const cardIds = cards.map(({ id }) => id);
    const recentSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000);
    const [reviewCounts, successfulCounts, recentCounts, recentSuccessCounts] =
      await Promise.all([
        transaction.reviewEvent.groupBy({
          by: ["learningCardId"],
          where: { userId, learningCardId: { in: cardIds } },
          _count: { _all: true },
        }),
        transaction.reviewEvent.groupBy({
          by: ["learningCardId"],
          where: {
            userId,
            learningCardId: { in: cardIds },
            isCorrect: true,
          },
          _count: { _all: true },
        }),
        transaction.reviewEvent.groupBy({
          by: ["learningCardId"],
          where: {
            userId,
            learningCardId: { in: cardIds },
            effectiveOccurredAt: { gte: recentSince },
          },
          _count: { _all: true },
        }),
        transaction.reviewEvent.groupBy({
          by: ["learningCardId"],
          where: {
            userId,
            learningCardId: { in: cardIds },
            effectiveOccurredAt: { gte: recentSince },
            isCorrect: true,
          },
          _count: { _all: true },
        }),
      ]);
    const countMap = (
      values: Array<{ learningCardId: string; _count: { _all: number } }>,
    ): Map<string, number> =>
      new Map(values.map((value) => [value.learningCardId, value._count._all]));
    const totals = countMap(reviewCounts);
    const successes = countMap(successfulCounts);
    const recent = countMap(recentCounts);
    const recentSuccesses = countMap(recentSuccessCounts);
    const metrics = new Map<string, ProgressCardMetrics>(
      cards.map((card) => {
        const state = card.userStates[0] ?? null;
        return [
          card.id,
          {
            learningCardId: card.id,
            state: state?.state ?? null,
            dueAt: state?.dueAt ?? null,
            successfulReviews: successes.get(card.id) ?? 0,
            totalReviews: totals.get(card.id) ?? 0,
            recentSuccessfulReviews: recentSuccesses.get(card.id) ?? 0,
            recentReviews: recent.get(card.id) ?? 0,
          },
        ];
      }),
    );
    const [decks, regions] = await Promise.all([
      transaction.deck.findMany({
        where: { status: DeckStatus.PUBLISHED },
        select: {
          id: true,
          cards: {
            where: { learningCard: { status: CardStatus.ACTIVE } },
            select: { learningCardId: true },
          },
        },
        orderBy: { id: "asc" },
      }),
      transaction.geoEntity.findMany({
        where: {
          kind: GeoEntityKind.REGION,
          status: GeoEntityStatus.ACTIVE,
        },
        select: {
          id: true,
          parentRelations: {
            where: {
              relationType: GeoRelationType.CONTAINS,
              OR: [{ validTo: null }, { validTo: { gte: now } }],
            },
            select: {
              child: {
                select: {
                  learningCards: {
                    where: { status: CardStatus.ACTIVE },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { id: "asc" },
      }),
    ]);
    const scope = (
      scopeType: ScopeProgress["scopeType"],
      scopeId: string,
      ids: string[],
    ): ScopeProgress => ({
      scopeType,
      scopeId,
      ...aggregateProgress(
        [...new Set(ids)]
          .map((id) => metrics.get(id))
          .filter((card): card is ProgressCardMetrics => card !== undefined),
        now,
        thresholds,
        ruleVersion,
      ),
    });

    return {
      cards: [...metrics.values()],
      decks: decks.map((deck) =>
        scope(
          "DECK",
          deck.id,
          deck.cards.map(({ learningCardId }) => learningCardId),
        ),
      ),
      regions: regions.map((region) =>
        scope(
          "REGION",
          region.id,
          region.parentRelations.flatMap(({ child }) =>
            child.learningCards.map(({ id }) => id),
          ),
        ),
      ),
    };
  }
}
