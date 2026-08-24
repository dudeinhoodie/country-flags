import { createHash, createHmac } from "node:crypto";

import { ConflictException, HttpException, Injectable } from "@nestjs/common";
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

import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
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
    const operation = await this.claimOperation(
      userId,
      request,
      requestHash,
      sourceInstallIdHash,
    );
    if (operation.status !== GuestImportStatus.PENDING) {
      return serialize(operation);
    }

    const deviceId = await this.upsertImportDevice(userId, sourceInstallIdHash);
    await this.prepareSessions(userId, request);

    let acceptedEventCount = 0;
    let duplicateEventCount = 0;
    let rejectedEventCount = 0;
    for (const review of request.reviews) {
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
      try {
        const result = await this.reviews.ingestBatch(userId, {
          payloadVersion: 1,
          events: [event],
        } satisfies ReviewBatchRequest);
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
      const updated = await transaction.guestImportOperation.update({
        where: { id: request.migrationId },
        data: {
          status,
          acceptedEventCount,
          duplicateEventCount,
          rejectedEventCount,
          completedAt: new Date(),
        },
      });
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
          },
        },
      });
      return updated;
    });
    return serialize(completed);
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

  private async claimOperation(
    userId: string,
    request: GuestImportRequest,
    requestHash: string,
    sourceInstallIdHash: string,
  ): Promise<GuestImportOperation> {
    try {
      return await this.database.guestImportOperation.create({
        data: {
          id: request.migrationId,
          userId,
          sourceInstallIdHash,
          requestHash,
        },
      });
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
      ) {
        throw error;
      }
      const existing =
        await this.database.guestImportOperation.findUniqueOrThrow({
          where: { id: request.migrationId },
        });
      if (
        existing.userId === userId &&
        existing.sourceInstallIdHash === sourceInstallIdHash &&
        existing.requestHash !== requestHash &&
        existing.status === GuestImportStatus.PENDING
      ) {
        // The same install retrying an import that never completed, with a
        // payload that moved on since — the guest kept studying while the
        // first attempt hung. A PENDING claim recorded nothing, so replacing
        // it resumes the import instead of dead-ending it in 409s forever;
        // a completed operation stays immutable below.
        return this.database.guestImportOperation.update({
          where: { id: request.migrationId },
          data: { requestHash },
        });
      }
      if (
        existing.userId !== userId ||
        existing.requestHash !== requestHash ||
        existing.sourceInstallIdHash !== sourceInstallIdHash
      ) {
        throw new ConflictException(
          "Migration ID was already used with another guest import",
        );
      }
      return existing;
    }
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
      update: { lastSeenAt: new Date() },
      select: { id: true },
    });
    return device.id;
  }

  private async prepareSessions(
    userId: string,
    request: GuestImportRequest,
  ): Promise<void> {
    for (const session of request.sessions) {
      const reviews = request.reviews.filter(
        ({ sessionId }) => sessionId === session.id,
      );
      await this.prepareSession(userId, session, reviews);
    }
  }

  private async prepareSession(
    userId: string,
    session: GuestSessionRequest,
    reviews: GuestReviewRequest[],
  ): Promise<void> {
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
    await this.database.$transaction(async (transaction) => {
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
        return;
      }
      const [deck, release, scheduler, cards] = await Promise.all([
        transaction.deck.findUnique({
          where: { id: session.deckId },
          select: { id: true },
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
