import { createHash, createHmac, randomUUID } from "node:crypto";

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AnswerMode,
  GuestImportStatus,
  Prisma,
  SelectionOrigin,
  SelectionReason,
  StudySessionStatus,
  type GuestImportOperation,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { DeckAccessService } from "../commerce/deck-access.service";
import type { ReviewBatchRequest } from "../reviews/review-batch.request";
import { ReviewsService } from "../reviews/reviews.service";
import {
  guestImportRequestHash,
  type GuestImportRequest,
  type GuestReviewRequest,
  type GuestSessionRequest,
} from "./guest-import.request";

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/**
 * How long one attempt owns an import. An attempt renews it before every
 * review it ingests, so only an attempt that stopped — a killed instance, a
 * dropped connection — lets it run out, and the next retry takes over.
 */
const IMPORT_LEASE_MS = 60_000;

/** An attempt that may write an import, and the proof it still may. */
interface ImportClaim {
  operation: GuestImportOperation;
  leaseToken: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function serialize(operation: GuestImportOperation): Record<string, unknown> {
  return {
    migrationId: operation.id,
    status: operation.status,
    acceptedEventCount: operation.acceptedEventCount,
    duplicateEventCount: operation.duplicateEventCount,
    rejectedEventCount: operation.rejectedEventCount,
    createdAt: operation.createdAt.toISOString(),
    completedAt: operation.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class GuestImportsService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly reviews: ReviewsService,
    private readonly deckAccess: DeckAccessService,
  ) {}

  async create(
    userId: string,
    request: GuestImportRequest,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const requestHash = guestImportRequestHash(request);
    const sourceInstallIdHash = this.sourceInstallHash(
      userId,
      request.sourceInstallId,
    );
    const { operation, leaseToken } = await this.claimOperation(
      userId,
      request,
      requestHash,
      sourceInstallIdHash,
    );
    if (leaseToken === null) {
      // Settled, or another attempt is running it right now. Either way
      // this request has nothing to add: it reports where the import is,
      // and a client still seeing PENDING asks again later.
      return serialize(operation);
    }

    const deviceId = await this.upsertImportDevice(userId, sourceInstallIdHash);
    const refusedSessionIds = await this.prepareSessions(
      userId,
      request,
      leaseToken,
    );
    if (refusedSessionIds === null) {
      return this.currentState(userId, request.migrationId);
    }
    const clockFloors = await this.releasePublications(request);
    const sessionVersions = new Map(
      request.sessions.map(({ id, contentVersion }) => [id, contentVersion]),
    );

    let acceptedEventCount = 0;
    let duplicateEventCount = 0;
    let rejectedEventCount = 0;
    for (const review of request.reviews) {
      if (!(await this.holdLease(request.migrationId, leaseToken))) {
        return this.currentState(userId, request.migrationId);
      }
      if (refusedSessionIds.has(review.sessionId)) {
        rejectedEventCount += 1;
        continue;
      }
      const event =
        review.answerMode === AnswerMode.SELF_RATED
          ? {
              id: review.id,
              sessionId: review.sessionId,
              learningCardId: review.learningCardId,
              answerMode: review.answerMode,
              rating: review.rating,
              clientOccurredAt: review.clientOccurredAt,
              clientSequence: review.clientSequence,
              responseTimeMs: review.responseTimeMs,
              deviceId,
              estimatedServerOccurredAt: null,
              baseStateVersion: null,
            }
          : {
              id: review.id,
              sessionId: review.sessionId,
              learningCardId: review.learningCardId,
              answerMode: review.answerMode,
              selectedOptionId: review.selectedOptionId,
              clientOccurredAt: review.clientOccurredAt,
              clientSequence: review.clientSequence,
              responseTimeMs: review.responseTimeMs,
              deviceId,
              estimatedServerOccurredAt: null,
              baseStateVersion: null,
            };
      // A guest never saw the server clock, so its own is the only record of
      // when it studied. The release it answered bounds that from below:
      // nobody answers a card before it was published.
      const notBefore = clockFloors.get(
        sessionVersions.get(review.sessionId) ?? "",
      );
      try {
        const result = await this.reviews.ingestBatch(
          userId,
          {
            payloadVersion: 1,
            events: [event],
          } satisfies ReviewBatchRequest,
          notBefore === undefined
            ? {}
            : { uncalibratedClientClock: { notBefore } },
        );
        const item = result.results[0];
        if (item?.status === "ACCEPTED") {
          acceptedEventCount += 1;
        } else if (item?.status === "DUPLICATE") {
          duplicateEventCount += 1;
        } else {
          rejectedEventCount += 1;
        }
      } catch (error) {
        if (error instanceof HttpException) {
          rejectedEventCount += 1;
          continue;
        }
        throw error;
      }
    }

    const status =
      rejectedEventCount === 0
        ? GuestImportStatus.APPLIED
        : acceptedEventCount + duplicateEventCount > 0
          ? GuestImportStatus.PARTIAL
          : GuestImportStatus.FAILED;
    const completed = await this.database.$transaction(async (transaction) => {
      // Only the lease holder writes the outcome. An attempt that lost its
      // lease while ingesting — it stalled past the lease and a retry took
      // over — leaves the outcome to the attempt that owns it now.
      const updated = await transaction.guestImportOperation.updateMany({
        where: {
          id: request.migrationId,
          userId,
          leaseToken,
          status: GuestImportStatus.PENDING,
        },
        data: {
          status,
          acceptedEventCount,
          duplicateEventCount,
          rejectedEventCount,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (updated.count === 0) {
        return null;
      }
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          action: "ACCOUNT_GUEST_PROGRESS_IMPORTED",
          targetType: "GUEST_IMPORT",
          targetId: request.migrationId,
          requestId,
          metadata: {
            status,
            acceptedEventCount,
            duplicateEventCount,
            rejectedEventCount,
            refusedSessionCount: refusedSessionIds.size,
          },
        },
      });
      return transaction.guestImportOperation.findUniqueOrThrow({
        where: { id: request.migrationId },
      });
    });
    return completed === null
      ? this.currentState(userId, request.migrationId)
      : serialize(completed);
  }

  async get(
    userId: string,
    migrationId: string,
  ): Promise<Record<string, unknown> | null> {
    const operation = await this.database.guestImportOperation.findFirst({
      where: { id: migrationId, userId },
    });
    return operation === null ? null : serialize(operation);
  }

  /**
   * Claims the import for this attempt, or says why it cannot.
   *
   * The claim lives in the operation row, not in this process: two requests
   * for one migration ID — a client retrying a request whose answer it
   * never received — may land on two instances. Whoever holds the unexpired
   * lease runs the import; everybody else reports its state.
   */
  private async claimOperation(
    userId: string,
    request: GuestImportRequest,
    requestHash: string,
    sourceInstallIdHash: string,
  ): Promise<ImportClaim> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + IMPORT_LEASE_MS);
    try {
      return {
        operation: await this.database.guestImportOperation.create({
          data: {
            id: request.migrationId,
            userId,
            sourceInstallIdHash,
            requestHash,
            leaseToken,
            leaseExpiresAt,
          },
        }),
        leaseToken,
      };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }

    const existing = await this.database.guestImportOperation.findUniqueOrThrow(
      {
        where: { id: request.migrationId },
      },
    );
    if (
      existing.userId !== userId ||
      existing.sourceInstallIdHash !== sourceInstallIdHash ||
      (existing.status !== GuestImportStatus.PENDING &&
        existing.requestHash !== requestHash)
    ) {
      // A completed operation is immutable, and a migration ID belongs to
      // the one account and installation that first used it.
      throw new ConflictException(
        "Migration ID was already used with another guest import",
      );
    }
    if (existing.status !== GuestImportStatus.PENDING) {
      return { operation: existing, leaseToken: null };
    }

    // The same payload waits for a live attempt. A different one — the
    // guest kept studying while the first attempt hung — supersedes it:
    // the running attempt loses its lease at its next review and stops,
    // and this one resumes with everything, the already imported reviews
    // coming back as duplicates.
    const taken = await this.database.guestImportOperation.updateMany({
      where: {
        id: request.migrationId,
        userId,
        status: GuestImportStatus.PENDING,
        ...(existing.requestHash === requestHash
          ? {
              OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
            }
          : {}),
      },
      data: { requestHash, leaseToken, leaseExpiresAt },
    });
    const current = await this.database.guestImportOperation.findUniqueOrThrow({
      where: { id: request.migrationId },
    });
    return {
      operation: current,
      leaseToken: taken.count === 1 ? leaseToken : null,
    };
  }

  /**
   * Extends this attempt's lease, or reports that it no longer has one: a
   * retry took the import over, or the account and the operation with it
   * were deleted. Either way this attempt must stop writing.
   */
  private async holdLease(
    migrationId: string,
    leaseToken: string,
  ): Promise<boolean> {
    const renewed = await this.database.guestImportOperation.updateMany({
      where: {
        id: migrationId,
        leaseToken,
        status: GuestImportStatus.PENDING,
      },
      data: { leaseExpiresAt: new Date(Date.now() + IMPORT_LEASE_MS) },
    });
    return renewed.count === 1;
  }

  private async currentState(
    userId: string,
    migrationId: string,
  ): Promise<Record<string, unknown>> {
    const operation = await this.database.guestImportOperation.findFirst({
      where: { id: migrationId, userId },
    });
    if (operation === null) {
      // Only an account deletion removes an operation.
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "ACCOUNT_UNAVAILABLE",
        "The account is not available",
      );
    }
    return serialize(operation);
  }

  /**
   * When each release the import names was published. A guest studies a
   * release its app already holds, so this is the earliest a review of it
   * can have happened; a release that never was published gives no bound,
   * and its reviews take the time of the import.
   */
  private async releasePublications(
    request: GuestImportRequest,
  ): Promise<Map<string, Date>> {
    const releases = await this.database.contentRelease.findMany({
      where: {
        version: {
          in: [...new Set(request.sessions.map((item) => item.contentVersion))],
        },
        publishedAt: { not: null },
      },
      select: { version: true, publishedAt: true },
    });
    return new Map(
      releases.flatMap(({ version, publishedAt }) =>
        publishedAt === null ? [] : [[version, publishedAt] as const],
      ),
    );
  }

  private async upsertImportDevice(
    userId: string,
    sourceInstallIdHash: string,
  ): Promise<string> {
    const settings = await this.database.userSettings.findUnique({
      where: { userId },
      select: { contentLocale: true, timezone: true },
    });
    const device = await this.database.device.upsert({
      where: {
        userId_clientGeneratedId: {
          userId,
          clientGeneratedId: `guest-import:${sourceInstallIdHash}`,
        },
      },
      create: {
        userId,
        clientGeneratedId: `guest-import:${sourceInstallIdHash}`,
        platform: "IOS",
        appVersion: "0.0.0",
        locale: settings?.contentLocale ?? "ru",
        timezone: settings?.timezone ?? "UTC",
      },
      // The reviews below are accepted only from a device that is not
      // removed, so a new import from the same installation restores it.
      update: { lastSeenAt: new Date(), deletedAt: null },
      select: { id: true },
    });
    return device.id;
  }

  /**
   * Creates the sessions and returns the ones refused for access, or null
   * once this attempt has lost its lease.
   */
  private async prepareSessions(
    userId: string,
    request: GuestImportRequest,
    leaseToken: string,
  ): Promise<Set<string> | null> {
    const refused = new Set<string>();
    for (const session of request.sessions) {
      if (!(await this.holdLease(request.migrationId, leaseToken))) {
        return null;
      }
      const reviews = request.reviews.filter(
        ({ sessionId }) => sessionId === session.id,
      );
      if (!(await this.prepareSessionOnce(userId, session, reviews))) {
        refused.add(session.id);
      }
    }
    return refused;
  }

  /**
   * A superseded attempt may still be creating the same session; the unique
   * key decides, and the loser checks the winner's row like any retry.
   */
  private async prepareSessionOnce(
    userId: string,
    session: GuestSessionRequest,
    reviews: GuestReviewRequest[],
  ): Promise<boolean> {
    try {
      return await this.prepareSession(userId, session, reviews);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.prepareSession(userId, session, reviews);
    }
  }

  private async prepareSession(
    userId: string,
    session: GuestSessionRequest,
    reviews: GuestReviewRequest[],
  ): Promise<boolean> {
    const cardIds = [
      ...new Set(reviews.map(({ learningCardId }) => learningCardId)),
    ];
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          ...session,
          startedAt: session.startedAt.toISOString(),
          completedAt: session.completedAt?.toISOString() ?? null,
          cardIds: [...cardIds].sort(),
        }),
      )
      .digest("hex");
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.studySession.findUnique({
        where: { id: session.id },
        select: { userId: true, requestHash: true },
      });
      if (existing !== null) {
        if (existing.userId !== userId || existing.requestHash !== hash) {
          throw new ConflictException(
            "Guest session ID was already used with another payload",
          );
        }
        return true;
      }
      const [deck, release, scheduler, cards] = await Promise.all([
        transaction.deck.findUnique({
          where: { id: session.deckId },
          select: { id: true, accessModel: true, requiredEntitlementKey: true },
        }),
        transaction.contentRelease.findUnique({
          where: { version: session.contentVersion },
          select: { version: true },
        }),
        transaction.schedulerDefinition.findFirst({
          where: { status: "ACTIVE" },
          orderBy: [{ activeFrom: "desc" }, { version: "asc" }],
          select: { version: true },
        }),
        transaction.learningCard.findMany({
          where: { id: { in: cardIds } },
          orderBy: { id: "asc" },
          include: {
            revisions: {
              where: { contentVersion: session.contentVersion },
              orderBy: { revision: "desc" },
              take: 1,
            },
          },
        }),
      ]);
      if (deck === null || release === null || scheduler === null) {
        throw new ConflictException(
          "Guest session references unavailable immutable content",
        );
      }
      // A guest cannot buy a deck — a purchase needs an account — so a
      // guest session on a paid deck the account does not own records
      // content nobody paid for. It is refused alone: the rest of the
      // guest's work still moves, and the session's reviews count as
      // rejected. The same guard as a new session, in this snapshot.
      if (!(await this.deckAccess.isGranted(deck, userId, transaction))) {
        return false;
      }
      const validCards = cards.filter(
        ({ revisions }) => revisions[0] !== undefined,
      );
      const optionEntityIds = [
        ...new Set(
          reviews.flatMap((review) =>
            review.answerMode === AnswerMode.MULTIPLE_CHOICE &&
            review.options !== null
              ? review.options.map(({ answerEntityId }) => answerEntityId)
              : [],
          ),
        ),
      ];
      const availableOptionEntities = new Set(
        (
          await transaction.geoEntity.findMany({
            where: { id: { in: optionEntityIds }, status: "ACTIVE" },
            select: { id: true },
          })
        ).map(({ id }) => id),
      );
      await transaction.studySession.create({
        data: {
          id: session.id,
          userId,
          deckId: session.deckId,
          mode: session.mode,
          selectionOrigin: SelectionOrigin.CLIENT_OFFLINE,
          requestedUniqueCount: session.requestedUniqueCount,
          selectedUniqueCount: validCards.length,
          status:
            session.completedAt === null
              ? StudySessionStatus.ACTIVE
              : StudySessionStatus.COMPLETED,
          contentVersion: session.contentVersion,
          schedulerVersion: scheduler.version,
          requestHash: hash,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          cards: {
            create: validCards.map((card, index) => {
              const options = this.optionsForCard(
                card.id,
                card.subjectEntityId,
                reviews,
                availableOptionEntities,
              );
              return {
                id: deterministicUuid(`${session.id}:${card.id}`),
                learningCardId: card.id,
                learningCardRevisionId: card.revisions[0]!.id,
                initialOrder: index,
                selectionReason: SelectionReason.MAINTENANCE,
                randomSeed: createHash("sha256")
                  .update(`${session.id}:${card.id}:guest`)
                  .digest("hex"),
                snapshot: {
                  source: "GUEST_IMPORT",
                  contentVersion: session.contentVersion,
                  learningCardId: card.id,
                  revisionId: card.revisions[0]!.id,
                },
                ...(options === undefined
                  ? {}
                  : {
                      options: {
                        create: options.map((option, position) => ({
                          id: option.id,
                          position,
                          answerEntityId: option.answerEntityId,
                          displaySnapshot: {
                            answerEntityId: option.answerEntityId,
                          },
                          isCorrect:
                            option.answerEntityId === card.subjectEntityId,
                        })),
                      },
                    }),
              };
            }),
          },
        },
      });
      return true;
    });
  }

  private optionsForCard(
    learningCardId: string,
    correctEntityId: string,
    reviews: GuestReviewRequest[],
    availableEntityIds: Set<string>,
  ): Array<{ id: string; answerEntityId: string }> | undefined {
    const snapshots: Array<Array<{ id: string; answerEntityId: string }>> = [];
    for (const review of reviews) {
      if (
        review.learningCardId === learningCardId &&
        review.answerMode === AnswerMode.MULTIPLE_CHOICE &&
        review.options !== null
      ) {
        snapshots.push(review.options);
      }
    }
    const first = snapshots[0];
    if (first === undefined) {
      return undefined;
    }
    const canonical = JSON.stringify(first);
    if (
      snapshots.some((snapshot) => JSON.stringify(snapshot) !== canonical) ||
      first.filter(({ answerEntityId }) => answerEntityId === correctEntityId)
        .length !== 1 ||
      first.some(
        ({ answerEntityId }) => !availableEntityIds.has(answerEntityId),
      )
    ) {
      return undefined;
    }
    return first;
  }

  private sourceInstallHash(userId: string, sourceInstallId: string): string {
    return createHmac(
      "sha256",
      this.config.getOrThrow<string>("ACCOUNT_DATA_HASH_SECRET"),
    )
      .update(`${userId}:${sourceInstallId}`)
      .digest("hex");
  }
}
