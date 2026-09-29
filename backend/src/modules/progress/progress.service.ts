import {
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

import { validationError } from "../../common/http/request-validation";
import { lastCompletedPortionAt, nextPortionAt } from "./portion-cadence";
import {
  remainingDailyAllowance,
  reviewedTodayCount,
} from "./daily-review-limit";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { lockAccountForWrite } from "../users/account-write-guard";
import {
  aggregateProgress,
  dailyQueue,
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
  /**
   * The cards the learner's day holds, chosen once for the account. Every
   * scope above counts its due cards against this, and so does the account
   * itself, so the rows under a queue add up to the number over them.
   */
  dueToday: ReadonlySet<string>;
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

/**
 * Every card taught by anything the classification places under an entity,
 * at any depth.
 *
 * A region contains subregions and the subregions contain the countries the
 * cards actually hang on, so a walk that stopped at the first level counted
 * nothing at all and left every region's progress, tier and achievement at
 * zero (#252). The pipeline resolves taxonomy decks the same way
 * (`deckMembers` in tools/content-pipeline/src/merge.ts); these two readings
 * of one tree have to agree, and `region-progress.spec.ts` pins them.
 *
 * The root itself contributes nothing: a region is not a country and has no
 * card of its own. Cycles cannot come from a well-formed catalogue, but the
 * walk carries a seen-set anyway — a bad relation should not hang a request.
 */
export function cardsUnder(
  rootId: string,
  childrenByParent: Map<string, string[]>,
  cardsByEntity: Map<string, string[]>,
): string[] {
  const cards: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [...(childrenByParent.get(rootId) ?? [])];
  while (queue.length > 0) {
    const entityId = queue.shift();
    if (entityId === undefined || seen.has(entityId)) {
      continue;
    }
    seen.add(entityId);
    cards.push(...(cardsByEntity.get(entityId) ?? []));
    queue.push(...(childrenByParent.get(entityId) ?? []));
  }
  return cards;
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

type EarnedAchievement = Prisma.UserAchievementGetPayload<{
  include: { definition: true };
}>;

/** What a progress answer is built from; reading it writes nothing. */
interface Projection {
  rule: { ruleVersion: number; thresholds: MasteryThreshold[] };
  snapshot: ProgressSnapshot;
  /** The achievements already stored. */
  earned: EarnedAchievement[];
  /** Achievements the snapshot has reached that are not stored yet. */
  pending: Prisma.UserAchievementCreateManyInput[];
  tierOfDefinition: ReadonlyMap<string, MasteryTier | null>;
}

/**
 * The account, deck and region figures of a projection. The tiers count the
 * pending achievements as well as the stored ones, so a read that stores
 * nothing answers exactly what a rebuild that stored them would have.
 */
function respond(
  projection: Projection,
  now: Date,
): Omit<ProgressRebuildResult, "newAchievements"> {
  const { rule, snapshot } = projection;
  const awarded = [
    ...projection.earned.map((achievement) => ({
      scopeType: achievement.scopeType,
      scopeId: achievement.scopeId,
      tier: achievement.definition.tier,
    })),
    ...projection.pending.map((grant) => ({
      scopeType: grant.scopeType,
      scopeId: grant.scopeId ?? null,
      tier: projection.tierOfDefinition.get(grant.definitionId) ?? null,
    })),
  ];
  const tiersByScope = new Map<string, Array<MasteryTier | null>>();
  for (const { scopeType, scopeId, tier } of awarded) {
    const key = `${scopeType}:${scopeId ?? "GLOBAL"}`;
    const tiers = tiersByScope.get(key) ?? [];
    tiers.push(tier);
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
  // The same queue the decks and regions were counted against: the
  // ceiling belongs to the learner's day, and every figure the app draws
  // from this rebuild is a share of one day rather than of one backlog.
  const accountAggregate = aggregateProgress(
    snapshot.cards,
    now,
    rule.thresholds,
    rule.ruleVersion,
    snapshot.dueToday,
  );
  return {
    account: {
      ...progressResponse(
        accountAggregate,
        highestTier(awarded.map(({ tier }) => tier)),
      ),
      decks: deckResponses,
      regions: regionResponses,
      updatedAt: now.toISOString(),
    },
    decks: deckResponses,
    regions: regionResponses,
  };
}

export interface DeckMasteryRow {
  deckId: string;
  tier: MasteryTier;
  masteredCardCount: number;
  totalCardCount: number;
  projectionVersion: number;
}

/**
 * What the per-deck mastery cache needs to become the projection: the rows
 * of decks no longer published, to delete, and the rows that are missing or
 * say something else, to write. A cache already right needs no write at all;
 * it used to be rewritten deck by deck on every rebuild.
 */
export function deckMasteryChanges(
  stored: readonly DeckMasteryRow[],
  decks: readonly ScopeProgress[],
): { stale: string[]; changed: DeckMasteryRow[] } {
  const published = new Set(decks.map(({ scopeId }) => scopeId));
  const storedByDeck = new Map(stored.map((row) => [row.deckId, row]));
  const changed: DeckMasteryRow[] = [];
  for (const deck of decks) {
    const wanted: DeckMasteryRow = {
      deckId: deck.scopeId,
      tier: deck.currentMasteryTier,
      masteredCardCount: deck.learnedCards,
      totalCardCount: deck.totalCards,
      projectionVersion: deck.ruleVersion,
    };
    const current = storedByDeck.get(deck.scopeId);
    if (
      current === undefined ||
      current.tier !== wanted.tier ||
      current.masteredCardCount !== wanted.masteredCardCount ||
      current.totalCardCount !== wanted.totalCardCount ||
      current.projectionVersion !== wanted.projectionVersion
    ) {
      changed.push(wanted);
    }
  }
  return {
    stale: stored
      .map(({ deckId }) => deckId)
      .filter((deckId) => !published.has(deckId)),
    changed,
  };
}

async function storeDeckMastery(
  transaction: Transaction,
  userId: string,
  decks: readonly ScopeProgress[],
): Promise<void> {
  const stored = await transaction.userDeckMastery.findMany({
    where: { userId },
    select: {
      deckId: true,
      tier: true,
      masteredCardCount: true,
      totalCardCount: true,
      projectionVersion: true,
    },
  });
  const { stale, changed } = deckMasteryChanges(stored, decks);
  if (stale.length > 0) {
    await transaction.userDeckMastery.deleteMany({
      where: { userId, deckId: { in: stale } },
    });
  }
  for (const { deckId, ...figures } of changed) {
    await transaction.userDeckMastery.upsert({
      where: { userId_deckId: { userId, deckId } },
      create: { userId, deckId, ...figures },
      update: figures,
    });
  }
}

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputes the learner's progress and stores what it earned: the per-deck
   * mastery cache and any achievement newly reached. The write path, for the
   * callers that change progress — a review upload, a reconciled card.
   *
   * `newAchievements` holds exactly the rows this call inserted. The insert
   * is `ON CONFLICT DO NOTHING RETURNING` against the one-per-scope unique
   * constraint, so when two rebuilds race for the same achievement the
   * database hands the row to one of them and the other one waits for that
   * commit and skips it: an achievement is announced as new at most once,
   * where comparing against a list read earlier announced it to both.
   */
  async rebuildUser(
    userId: string,
    now = new Date(),
  ): Promise<ProgressRebuildResult> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAccountForWrite(transaction, userId);
      const projection = await this.project(transaction, userId, now);
      await storeDeckMastery(transaction, userId, projection.snapshot.decks);
      const granted =
        projection.pending.length === 0
          ? []
          : await transaction.userAchievement.createManyAndReturn({
              data: projection.pending,
              skipDuplicates: true,
              include: { definition: true },
            });
      return {
        ...respond(projection, now),
        newAchievements: granted
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(achievementResponse),
      };
    });
  }

  /**
   * The same figures without storing anything, for the reads: the app asks
   * for progress, due summary and achievements in parallel every time it
   * syncs, and each of those used to rewrite the mastery cache and try the
   * achievement inserts — three writing transactions per sync, holding
   * connections and rows for nothing, since the answer was already stored.
   *
   * Read-only by declaration, so a write that creeps in later fails in the
   * tests rather than in the morning peak, and Repeatable Read so the counts,
   * the states and the achievements come from one snapshot; a read-only
   * transaction at that level is never aborted for serialization. An
   * achievement earned but not stored yet still counts toward
   * `highestAchievementTier`, so the answer is the one a rebuild would give.
   */
  private read<T>(
    userId: string,
    now: Date,
    finish: (projection: Projection, transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
        return finish(
          await this.project(transaction, userId, now),
          transaction,
        );
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async getDueSummary(userId: string): Promise<Record<string, unknown>> {
    const now = new Date();
    const { account, lastPortion } = await this.read(
      userId,
      now,
      async (projection, transaction) => ({
        account: respond(projection, now).account as {
          dueCards: number;
          overdueCards: number;
          dueLearningCards: number;
          dueRelearningCards: number;
          newCards: number;
          learningCards: number;
          relearningCards: number;
          reviewCards: number;
          updatedAt: string;
        },
        lastPortion: await lastCompletedPortionAt(transaction, userId),
      }),
    );
    // When the next portion opens, so the app can say so instead of dealing
    // cards that are not owed and letting them read as a queue. Omitted rather
    // than sent as null when a portion is open now: the field's absence is the
    // answer, and a client that has not learned about it is unaffected.
    const opensAt = nextPortionAt(lastPortion, now);

    return {
      overdue: account.overdueCards,
      learning: account.dueLearningCards,
      relearning: account.dueRelearningCards,
      newCards: account.newCards,
      review: account.reviewCards,
      totalDue: account.dueCards,
      serverTime: account.updatedAt,
      ...(opensAt === null ? {} : { nextPortionAt: opensAt.toISOString() }),
    };
  }

  async getProgress(userId: string): Promise<Record<string, unknown>> {
    const now = new Date();
    return this.read(userId, now, (projection) =>
      Promise.resolve(respond(projection, now).account),
    );
  }

  async getDeckProgress(
    userId: string,
    deckId: string,
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const deck = await this.read(userId, now, (projection) =>
      Promise.resolve(
        respond(projection, now).decks.find((item) => item.deckId === deckId),
      ),
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
    const afterId = cursor === undefined ? null : this.decodeCursor(cursor);
    // The list is of stored rows, so an achievement earned since the last
    // upload — by time passing over the 30-day accuracy window, or by content
    // retiring cards — is stored first. That is the rare case; the usual one
    // finds nothing pending and writes nothing.
    const pending = await this.read(userId, new Date(), (projection) =>
      Promise.resolve(projection.pending.length),
    );
    if (pending > 0) {
      await this.rebuildUser(userId);
    }
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

  /**
   * Everything a response is made of, read and nothing written: the
   * snapshot, the stored achievements, and the achievements the snapshot has
   * earned that are not stored yet.
   */
  private async project(
    transaction: Transaction,
    userId: string,
    now: Date,
  ): Promise<Projection> {
    const activeDefinitions = await transaction.achievementDefinition.findMany({
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
    // The day's ceiling is read before the snapshot, because the snapshot
    // is built against it: the account chooses today's cards once and every
    // deck and region counts its share of that one queue.
    const settings = await transaction.userSettings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const allowance = remainingDailyAllowance(
      await reviewedTodayCount(
        transaction,
        userId,
        settings?.timezone ?? "UTC",
      ),
    );
    const snapshot = await this.loadSnapshot(
      transaction,
      userId,
      now,
      rule.thresholds,
      rule.ruleVersion,
      allowance,
    );
    const earned = await transaction.userAchievement.findMany({
      where: { userId },
      include: { definition: true },
      orderBy: [{ earnedAt: "asc" }, { id: "asc" }],
    });
    const earnedKeys = new Set(earned.map(grantKey));
    const pending: Prisma.UserAchievementCreateManyInput[] = [];
    for (const scope of [...snapshot.decks, ...snapshot.regions]) {
      for (const definition of definitions) {
        if (
          definition.tier === null ||
          masteryTierRank(scope.currentMasteryTier) <
            masteryTierRank(definition.tier)
        ) {
          continue;
        }
        const grant = {
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
        };
        if (!earnedKeys.has(grantKey(grant))) {
          pending.push(grant);
        }
      }
    }
    return {
      rule,
      snapshot,
      earned,
      pending,
      tierOfDefinition: new Map(
        definitions.map(({ id, tier }) => [id, tier] as const),
      ),
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
    validationError(
      "cursor",
      "cannot be read; omit it to start from the beginning",
    );
  }

  private async loadSnapshot(
    transaction: Transaction,
    userId: string,
    now: Date,
    thresholds: readonly MasteryThreshold[],
    ruleVersion: number,
    allowance: number,
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
    const [decks, regions, relations, cardsByEntityRows] = await Promise.all([
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
        select: { id: true },
        orderBy: { id: "asc" },
      }),
      // The classification, whole. A region's own children are subregions
      // and the cards hang on the countries below those, so the walk has to
      // be transitive — read once here rather than joined per region.
      transaction.geoRelation.findMany({
        where: {
          relationType: GeoRelationType.CONTAINS,
          OR: [{ validTo: null }, { validTo: { gte: now } }],
        },
        select: { parentEntityId: true, childEntityId: true },
      }),
      transaction.learningCard.findMany({
        where: { status: CardStatus.ACTIVE },
        select: { id: true, subjectEntityId: true },
      }),
    ]);
    const childrenByParent = new Map<string, string[]>();
    for (const relation of relations) {
      const siblings = childrenByParent.get(relation.parentEntityId) ?? [];
      siblings.push(relation.childEntityId);
      childrenByParent.set(relation.parentEntityId, siblings);
    }
    const cardsByEntity = new Map<string, string[]>();
    for (const card of cardsByEntityRows) {
      const cards = cardsByEntity.get(card.subjectEntityId) ?? [];
      cards.push(card.id);
      cardsByEntity.set(card.subjectEntityId, cards);
    }

    // Today's cards, chosen once across the whole account. A deck asked to cut
    // its own backlog to the day's ceiling would report a share of a queue
    // nobody is going to be dealt: the decks overlap, so each of them cutting
    // separately adds up to several times the day.
    const dueToday = dailyQueue([...metrics.values()], now, allowance);

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
        dueToday,
      ),
    });

    return {
      dueToday,
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
          cardsUnder(region.id, childrenByParent, cardsByEntity),
        ),
      ),
    };
  }
}
