import { createHash } from "node:crypto";

import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AnswerMode,
  CardLearningState,
  type Prisma,
  ReviewRating,
  SchedulerDefinitionStatus,
  UserChangeOperation,
  UserChangeResourceType,
} from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import { ProgressService } from "../progress/progress.service";
import { Fsrs6SchedulerAdapter } from "../scheduler/fsrs6-scheduler.adapter";
import type {
  SchedulerCardState,
  SchedulerDefinitionData,
} from "../scheduler/scheduler";
import { UserChangesService } from "../sync/user-changes.service";
import {
  type ReviewBatchRequest,
  type ReviewEventRequest,
  reviewPayloadHash,
} from "./review-batch.request";
import { normalizeReviewTime, orderReviewEvents } from "./review-ordering";

type Transaction = Prisma.TransactionClient;

interface ProjectionWithVersion extends SchedulerCardState {
  stateVersion: number;
  updatedAt: Date;
}

export interface ReviewResult {
  eventId: string;
  status: "ACCEPTED" | "DUPLICATE" | "REJECTED" | "RECONCILIATION_PENDING";
  rejectionCode: string | null;
  canonicalRating: ReviewRating | null;
  isCorrect: boolean | null;
  correctOptionId: string | null;
  cardState: Record<string, unknown> | null;
}

export interface ReviewBatchResult extends Record<string, unknown> {
  results: ReviewResult[];
  achievements: unknown[];
  deckSummaries: unknown[];
  serverTime: string;
  nextSyncCursor: string;
}

interface CanonicalGrading {
  rating: ReviewRating;
  isCorrect: boolean;
  selectedOptionId: string | null;
  correctOptionId: string | null;
}

class RejectedReviewError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: Prisma.Decimal): number {
  return value.toNumber();
}

function definitionData(definition: {
  version: string;
  algorithmMajor: number;
  packageName: string;
  packageVersion: string;
  parametersVersion: string;
  parameters: Prisma.JsonValue;
  defaultDesiredRetention: Prisma.Decimal;
}): SchedulerDefinitionData {
  return {
    version: definition.version,
    algorithmMajor: definition.algorithmMajor,
    packageName: definition.packageName,
    packageVersion: definition.packageVersion,
    parametersVersion: definition.parametersVersion,
    parameters: definition.parameters,
    defaultDesiredRetention: decimal(definition.defaultDesiredRetention),
  };
}

function projectionFromDatabase(
  state: {
    state: CardLearningState;
    difficulty: Prisma.Decimal;
    stability: Prisma.Decimal;
    retrievabilityAtReview: Prisma.Decimal | null;
    dueAt: Date;
    lastReviewedAt: Date | null;
    repetitions: number;
    lapses: number;
    schedulerVersion: string;
    schedulerParametersVersion: string;
    stateVersion: number;
    updatedAt: Date;
  } | null,
): ProjectionWithVersion | null {
  if (state === null) {
    return null;
  }
  return {
    state: state.state,
    difficulty: decimal(state.difficulty),
    stability: decimal(state.stability),
    retrievabilityAtReview:
      state.retrievabilityAtReview === null
        ? null
        : decimal(state.retrievabilityAtReview),
    dueAt: state.dueAt,
    lastReviewedAt: state.lastReviewedAt,
    repetitions: state.repetitions,
    lapses: state.lapses,
    schedulerVersion: state.schedulerVersion,
    schedulerParametersVersion: state.schedulerParametersVersion,
    stateVersion: state.stateVersion,
    updatedAt: state.updatedAt,
  };
}

function projectionSnapshot(
  state: ProjectionWithVersion,
): Prisma.InputJsonObject {
  return {
    state: state.state,
    difficulty: state.difficulty,
    stability: state.stability,
    retrievabilityAtReview: state.retrievabilityAtReview,
    dueAt: state.dueAt.toISOString(),
    lastReviewedAt: state.lastReviewedAt?.toISOString() ?? null,
    repetitions: state.repetitions,
    lapses: state.lapses,
    schedulerVersion: state.schedulerVersion,
    schedulerParametersVersion: state.schedulerParametersVersion,
    stateVersion: state.stateVersion,
    updatedAt: state.updatedAt.toISOString(),
  };
}

function projectionFromSnapshot(
  metadata: Prisma.JsonValue,
): ProjectionWithVersion | null {
  if (
    !isRecord(metadata) ||
    !("baseProjection" in metadata) ||
    !isRecord(metadata.baseProjection)
  ) {
    return null;
  }
  const value = metadata.baseProjection;
  if (
    typeof value.state !== "string" ||
    !Object.values(CardLearningState).includes(
      value.state as CardLearningState,
    ) ||
    typeof value.difficulty !== "number" ||
    typeof value.stability !== "number" ||
    !(
      value.retrievabilityAtReview === null ||
      typeof value.retrievabilityAtReview === "number"
    ) ||
    typeof value.dueAt !== "string" ||
    !(
      value.lastReviewedAt === null || typeof value.lastReviewedAt === "string"
    ) ||
    typeof value.repetitions !== "number" ||
    typeof value.lapses !== "number" ||
    typeof value.schedulerVersion !== "string" ||
    typeof value.schedulerParametersVersion !== "string" ||
    typeof value.stateVersion !== "number" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new Error("Stored review base projection is invalid");
  }
  return {
    state: value.state as CardLearningState,
    difficulty: value.difficulty,
    stability: value.stability,
    retrievabilityAtReview: value.retrievabilityAtReview,
    dueAt: new Date(value.dueAt),
    lastReviewedAt:
      value.lastReviewedAt === null ? null : new Date(value.lastReviewedAt),
    repetitions: value.repetitions,
    lapses: value.lapses,
    schedulerVersion: value.schedulerVersion,
    schedulerParametersVersion: value.schedulerParametersVersion,
    stateVersion: value.stateVersion,
    updatedAt: new Date(value.updatedAt),
  };
}

function stateResponse(
  learningCardId: string,
  state: ProjectionWithVersion | null,
): Prisma.InputJsonObject | null {
  if (state === null) {
    return null;
  }
  return {
    learningCardId,
    state: state.state,
    difficulty: state.difficulty,
    stability: state.stability,
    dueAt: state.dueAt.toISOString(),
    repetitions: state.repetitions,
    lapses: state.lapses,
    schedulerVersion: state.schedulerVersion,
    schedulerParametersVersion: state.schedulerParametersVersion,
    stateVersion: state.stateVersion,
    updatedAt: state.updatedAt.toISOString(),
  };
}

function checksum(value: Prisma.InputJsonValue): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function prismaErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function compareCanonicalTuple(
  left: { id: string; effectiveOccurredAt: Date; receivedAt: Date },
  right: { id: string; effectiveOccurredAt: Date; receivedAt: Date },
): number {
  const effective =
    left.effectiveOccurredAt.getTime() - right.effectiveOccurredAt.getTime();
  if (effective !== 0) {
    return effective;
  }
  const received = left.receivedAt.getTime() - right.receivedAt.getTime();
  return received !== 0 ? received : left.id.localeCompare(right.id);
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
    private readonly scheduler: Fsrs6SchedulerAdapter,
    private readonly userChanges: UserChangesService,
  ) {}

  async ingestBatch(
    userId: string,
    request: ReviewBatchRequest,
  ): Promise<ReviewBatchResult> {
    const results: ReviewResult[] = [];
    for (const event of request.events) {
      try {
        results.push(
          await this.ingestWithRetry(userId, request.payloadVersion, event),
        );
      } catch (error) {
        if (error instanceof RejectedReviewError) {
          results.push({
            eventId: event.id,
            status: "REJECTED",
            rejectionCode: error.code,
            canonicalRating: null,
            isCorrect: null,
            correctOptionId: null,
            cardState: null,
          });
          continue;
        }
        throw error;
      }
    }

    const projection = await this.progress.rebuildUser(userId);
    const serverTime = new Date();
    return {
      results,
      achievements: projection.newAchievements,
      deckSummaries: projection.decks,
      serverTime: serverTime.toISOString(),
      nextSyncCursor: await this.userChanges.latestCursor(userId),
    };
  }

  private async ingestWithRetry(
    userId: string,
    payloadVersion: number,
    event: ReviewEventRequest,
  ): Promise<ReviewResult> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (transaction) =>
            this.ingestOne(transaction, userId, payloadVersion, event),
          {
            isolationLevel: "Serializable",
            maxWait: 10_000,
            timeout: 30_000,
          },
        );
      } catch (error) {
        const code = prismaErrorCode(error);
        if ((code === "P2034" || code === "P2002") && attempt < 3) {
          continue;
        }
        if (
          error instanceof Error &&
          error.message.startsWith("Unsupported scheduler definition")
        ) {
          throw new ServiceUnavailableException(
            "Active scheduler definition is unsupported",
          );
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException("Review transaction retry exhausted");
  }

  private async ingestOne(
    transaction: Transaction,
    userId: string,
    payloadVersion: number,
    event: ReviewEventRequest,
  ): Promise<ReviewResult> {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${userId}:${event.learningCardId}`}, 0)
      )::text AS lock_result
    `;
    const payloadHash = reviewPayloadHash(payloadVersion, event);
    const existing = await transaction.reviewEvent.findUnique({
      where: { userId_id: { userId, id: event.id } },
      include: { selectedOption: true },
    });
    if (existing !== null) {
      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          "Review event ID was already used with another payload",
        );
      }
      const state = projectionFromDatabase(
        await transaction.userCardState.findUnique({
          where: {
            userId_learningCardId: {
              userId,
              learningCardId: existing.learningCardId,
            },
          },
        }),
      );
      const correctOption =
        existing.answerMode === AnswerMode.MULTIPLE_CHOICE &&
        existing.sessionId !== null
          ? await transaction.studySessionCardOption.findFirst({
              where: {
                sessionCard: {
                  sessionId: existing.sessionId,
                  learningCardId: existing.learningCardId,
                },
                isCorrect: true,
              },
              select: { id: true },
            })
          : null;
      return {
        eventId: event.id,
        status: "DUPLICATE",
        rejectionCode: null,
        canonicalRating: existing.rating,
        isCorrect: existing.isCorrect,
        correctOptionId: correctOption?.id ?? null,
        cardState: stateResponse(existing.learningCardId, state),
      };
    }

    const sequenceOwner = await transaction.reviewEvent.findUnique({
      where: {
        userId_deviceId_clientSequence: {
          userId,
          deviceId: event.deviceId,
          clientSequence: event.clientSequence,
        },
      },
      select: { id: true },
    });
    if (sequenceOwner !== null) {
      throw new ConflictException(
        "clientSequence was already used by another review event",
      );
    }

    const session = await transaction.studySession.findFirst({
      where: { id: event.sessionId, userId },
      include: {
        cards: {
          where: { learningCardId: event.learningCardId },
          include: { options: true },
        },
      },
    });
    if (session === null) {
      throw new RejectedReviewError("SESSION_NOT_FOUND");
    }
    const sessionCard = session.cards[0];
    if (sessionCard === undefined) {
      throw new RejectedReviewError("CARD_NOT_IN_SESSION");
    }
    if (session.mode !== event.answerMode) {
      throw new RejectedReviewError("ANSWER_MODE_MISMATCH");
    }
    const device = await transaction.device.findFirst({
      where: { id: event.deviceId, userId },
      select: { id: true },
    });
    if (device === null) {
      throw new RejectedReviewError("DEVICE_NOT_FOUND");
    }

    const grading = this.grade(event, sessionCard.options);
    const activeScheduler = await transaction.schedulerDefinition.findFirst({
      where: { status: SchedulerDefinitionStatus.ACTIVE },
      orderBy: [{ activeFrom: "desc" }, { version: "asc" }],
    });
    if (activeScheduler === null) {
      throw new ServiceUnavailableException(
        "No active scheduler definition is available",
      );
    }
    const activeDefinition = definitionData(activeScheduler);

    const [predecessor, successor, currentStateRow, previousEvents] =
      await Promise.all([
        transaction.reviewEvent.findFirst({
          where: {
            userId,
            deviceId: event.deviceId,
            clientSequence: { lt: event.clientSequence },
          },
          orderBy: { clientSequence: "desc" },
          select: { effectiveOccurredAt: true },
        }),
        transaction.reviewEvent.findFirst({
          where: {
            userId,
            deviceId: event.deviceId,
            clientSequence: { gt: event.clientSequence },
          },
          orderBy: { clientSequence: "asc" },
          select: { effectiveOccurredAt: true },
        }),
        transaction.userCardState.findUnique({
          where: {
            userId_learningCardId: {
              userId,
              learningCardId: event.learningCardId,
            },
          },
        }),
        transaction.reviewEvent.findMany({
          where: { userId, learningCardId: event.learningCardId },
        }),
      ]);
    const currentState = projectionFromDatabase(currentStateRow);
    const receivedAt = new Date();
    const normalizedTime = normalizeReviewTime({
      clientOccurredAt: event.clientOccurredAt,
      estimatedServerOccurredAt: event.estimatedServerOccurredAt,
      receivedAt,
      predecessor,
      successor,
    });
    const metadata: Prisma.InputJsonObject =
      previousEvents.length === 0 && currentState !== null
        ? { baseProjection: projectionSnapshot(currentState) }
        : {};
    if (
      currentState !== null &&
      currentState.schedulerVersion !== activeDefinition.version &&
      previousEvents.length > 0
    ) {
      await this.migrateProjection(
        transaction,
        userId,
        event.learningCardId,
        currentState,
        activeDefinition,
        orderReviewEvents(previousEvents).at(-1),
      );
    }

    await transaction.reviewEvent.create({
      data: {
        id: event.id,
        userId,
        learningCardId: event.learningCardId,
        sessionId: event.sessionId,
        deviceId: event.deviceId,
        rating: grading.rating,
        isCorrect: grading.isCorrect,
        answerMode: event.answerMode,
        selectedOptionId: grading.selectedOptionId,
        responseTimeMs: event.responseTimeMs,
        clientOccurredAt: event.clientOccurredAt,
        estimatedServerOccurredAt: event.estimatedServerOccurredAt,
        effectiveOccurredAt: normalizedTime.effectiveOccurredAt,
        receivedAt,
        clientSequence: event.clientSequence,
        timeConfidence: normalizedTime.timeConfidence,
        baseStateVersion: event.baseStateVersion,
        schedulerVersion: activeDefinition.version,
        schedulerParametersVersion: activeDefinition.parametersVersion,
        payloadVersion,
        payloadHash,
        metadata,
      },
    });

    const checkpointCandidates =
      await transaction.schedulerMigrationCheckpoint.findMany({
        where: {
          userId,
          learningCardId: event.learningCardId,
          cutoffEffectiveOccurredAt: {
            gte: normalizedTime.effectiveOccurredAt,
          },
        },
        orderBy: { cutoffEffectiveOccurredAt: "desc" },
      });
    let lateCheckpoint: (typeof checkpointCandidates)[number] | null = null;
    for (const checkpoint of checkpointCandidates) {
      const cutoffEvent = await transaction.reviewEvent.findUnique({
        where: {
          userId_id: { userId, id: checkpoint.cutoffEventId },
        },
        select: {
          id: true,
          effectiveOccurredAt: true,
          receivedAt: true,
        },
      });
      if (
        cutoffEvent !== null &&
        compareCanonicalTuple(
          {
            id: event.id,
            effectiveOccurredAt: normalizedTime.effectiveOccurredAt,
            receivedAt,
          },
          cutoffEvent,
        ) < 0
      ) {
        lateCheckpoint = checkpoint;
        break;
      }
    }
    if (lateCheckpoint !== null) {
      await transaction.reconciliationJob.createMany({
        data: {
          userId,
          learningCardId: event.learningCardId,
          targetSchedulerVersion: activeDefinition.version,
          reason: "LATE_EVENT_BEFORE_SCHEDULER_CHECKPOINT",
        },
        skipDuplicates: true,
      });
      await transaction.learningOutboxEvent.create({
        data: {
          userId,
          sourceEventId: event.id,
          learningCardId: event.learningCardId,
          eventType: "learning.reconciliation.pending",
          occurredAt: receivedAt,
          payload: {
            reviewEventId: event.id,
            learningCardId: event.learningCardId,
            checkpointId: lateCheckpoint.id,
            cardState: stateResponse(event.learningCardId, currentState),
          },
        },
      });
      return {
        eventId: event.id,
        status: "RECONCILIATION_PENDING",
        rejectionCode: null,
        canonicalRating: grading.rating,
        isCorrect: grading.isCorrect,
        correctOptionId: grading.correctOptionId,
        cardState: stateResponse(event.learningCardId, currentState),
      };
    }

    const canonical = await this.computeCanonicalProjection(
      transaction,
      userId,
      event.learningCardId,
      activeDefinition,
    );

    await transaction.userCardState.upsert({
      where: {
        userId_learningCardId: {
          userId,
          learningCardId: event.learningCardId,
        },
      },
      create: {
        userId,
        learningCardId: event.learningCardId,
        ...this.projectionData(canonical),
      },
      update: this.projectionData(canonical),
    });
    await transaction.learningOutboxEvent.create({
      data: {
        userId,
        sourceEventId: event.id,
        learningCardId: event.learningCardId,
        eventType: "learning.projection.updated",
        occurredAt: receivedAt,
        payload: {
          reviewEventId: event.id,
          learningCardId: event.learningCardId,
          stateVersion: canonical.stateVersion,
          schedulerVersion: canonical.schedulerVersion,
          schedulerParametersVersion: canonical.schedulerParametersVersion,
          cardState: stateResponse(event.learningCardId, canonical),
          replayed: previousEvents.some(
            ({ effectiveOccurredAt }) =>
              effectiveOccurredAt > normalizedTime.effectiveOccurredAt,
          ),
        },
      },
    });
    await transaction.userChange.create({
      data: {
        userId,
        operation: UserChangeOperation.UPSERT,
        resourceType: UserChangeResourceType.CARD_STATE,
        resourceId: event.learningCardId,
        sourceOperationId: event.id,
        payload: stateResponse(event.learningCardId, canonical)!,
        occurredAt: receivedAt,
      },
    });

    return {
      eventId: event.id,
      status: "ACCEPTED",
      rejectionCode: null,
      canonicalRating: grading.rating,
      isCorrect: grading.isCorrect,
      correctOptionId: grading.correctOptionId,
      cardState: stateResponse(event.learningCardId, canonical),
    };
  }

  async reconcileCard(
    jobId: string,
    userId: string,
    learningCardId: string,
    targetSchedulerVersion: string,
    leaseToken: string,
  ): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${userId}:${learningCardId}`}, 0)
          )::text AS lock_result
        `;
        const targetScheduler =
          await transaction.schedulerDefinition.findUnique({
            where: { version: targetSchedulerVersion },
          });
        if (targetScheduler === null) {
          throw new Error("Target scheduler definition is unavailable");
        }
        const targetDefinition = definitionData(targetScheduler);
        const canonical = await this.computeCanonicalProjection(
          transaction,
          userId,
          learningCardId,
          targetDefinition,
        );
        await transaction.userCardState.upsert({
          where: { userId_learningCardId: { userId, learningCardId } },
          create: {
            userId,
            learningCardId,
            ...this.projectionData(canonical),
          },
          update: this.projectionData(canonical),
        });
        const snapshot = projectionSnapshot(canonical);
        await transaction.schedulerMigrationCheckpoint.updateMany({
          where: {
            userId,
            learningCardId,
            toSchedulerVersion: targetDefinition.version,
          },
          data: {
            migratedState: snapshot,
            stateChecksum: checksum(snapshot),
            reconciliationVersion: { increment: 1 },
            lastReconciledAt: new Date(),
          },
        });
        const reconciledAt = new Date();
        await transaction.learningOutboxEvent.createMany({
          data: {
            userId,
            sourceEventId: jobId,
            learningCardId,
            eventType: "learning.projection.reconciled",
            occurredAt: reconciledAt,
            payload: {
              learningCardId,
              cardState: stateResponse(learningCardId, canonical),
              stateChecksum: checksum(snapshot),
            },
          },
          skipDuplicates: true,
        });
        await transaction.userChange.createMany({
          data: {
            userId,
            operation: UserChangeOperation.UPSERT,
            resourceType: UserChangeResourceType.CARD_STATE,
            resourceId: learningCardId,
            sourceOperationId: jobId,
            payload: stateResponse(learningCardId, canonical)!,
            occurredAt: reconciledAt,
          },
          skipDuplicates: true,
        });
        const completed = await transaction.reconciliationJob.updateMany({
          where: {
            id: jobId,
            status: "PROCESSING",
            leaseToken,
          },
          data: {
            status: "COMPLETED",
            completedAt: reconciledAt,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        });
        if (completed.count !== 1) {
          throw new Error("Reconciliation lease was lost");
        }
        return stateResponse(learningCardId, canonical) ?? {};
      },
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 },
    );
  }

  private grade(
    event: ReviewEventRequest,
    options: Array<{ id: string; isCorrect: boolean }>,
  ): CanonicalGrading {
    if (event.answerMode === AnswerMode.SELF_RATED) {
      return {
        rating: event.rating,
        isCorrect: event.rating !== ReviewRating.AGAIN,
        selectedOptionId: null,
        correctOptionId: null,
      };
    }
    const selected = options.find(({ id }) => id === event.selectedOptionId);
    const correct = options.filter(({ isCorrect }) => isCorrect);
    if (options.length === 0 || correct.length !== 1) {
      throw new RejectedReviewError("OPTION_SNAPSHOT_INVALID");
    }
    if (selected === undefined) {
      throw new RejectedReviewError("OPTION_NOT_IN_SESSION");
    }
    return {
      rating: selected.isCorrect ? ReviewRating.GOOD : ReviewRating.AGAIN,
      isCorrect: selected.isCorrect,
      selectedOptionId: selected.id,
      correctOptionId: correct[0]?.id ?? null,
    };
  }

  private projectionData(
    state: ProjectionWithVersion,
  ): Omit<
    Prisma.UserCardStateUncheckedCreateInput,
    "userId" | "learningCardId"
  > {
    return {
      state: state.state,
      difficulty: state.difficulty,
      stability: state.stability,
      retrievabilityAtReview: state.retrievabilityAtReview,
      dueAt: state.dueAt,
      lastReviewedAt: state.lastReviewedAt,
      repetitions: state.repetitions,
      lapses: state.lapses,
      schedulerVersion: state.schedulerVersion,
      schedulerParametersVersion: state.schedulerParametersVersion,
      stateVersion: state.stateVersion,
      updatedAt: state.updatedAt,
    };
  }

  private async computeCanonicalProjection(
    transaction: Transaction,
    userId: string,
    learningCardId: string,
    activeDefinition: SchedulerDefinitionData,
  ): Promise<ProjectionWithVersion> {
    const allEvents = await transaction.reviewEvent.findMany({
      where: { userId, learningCardId },
    });
    const definitions = await transaction.schedulerDefinition.findMany({
      where: {
        version: {
          in: [
            ...new Set(
              allEvents.map(({ schedulerVersion }) => schedulerVersion),
            ),
          ],
        },
      },
    });
    const definitionByVersion = new Map(
      definitions.map((definition) => [
        definition.version,
        definitionData(definition),
      ]),
    );
    const orderedEvents = orderReviewEvents(allEvents);
    const base =
      allEvents
        .map(({ metadata }) => projectionFromSnapshot(metadata))
        .find((projection) => projection !== null) ?? null;
    let projection: SchedulerCardState | null = base;
    for (const event of orderedEvents) {
      const definition = definitionByVersion.get(event.schedulerVersion);
      if (definition === undefined) {
        throw new Error(
          `Scheduler definition ${event.schedulerVersion} is missing`,
        );
      }
      projection = this.scheduler.applyReview(
        projection,
        { rating: event.rating, occurredAt: event.effectiveOccurredAt },
        definition,
      );
    }
    if (projection === null) {
      throw new Error("Review history did not produce a projection");
    }
    const latestReceivedAt = new Date(
      Math.max(...allEvents.map(({ receivedAt }) => receivedAt.getTime())),
    );
    const projected: ProjectionWithVersion = {
      ...projection,
      stateVersion: (base?.stateVersion ?? 0) + allEvents.length,
      updatedAt: latestReceivedAt,
    };
    return projected.schedulerVersion === activeDefinition.version
      ? projected
      : this.migrateProjection(
          transaction,
          userId,
          learningCardId,
          projected,
          activeDefinition,
          orderedEvents.at(-1),
        );
  }

  private async migrateProjection(
    transaction: Transaction,
    userId: string,
    learningCardId: string,
    state: ProjectionWithVersion,
    target: SchedulerDefinitionData,
    cutoff:
      | {
          id: string;
          effectiveOccurredAt: Date;
        }
      | undefined,
  ): Promise<ProjectionWithVersion> {
    if (cutoff === undefined) {
      throw new Error("Scheduler migration requires a cutoff review event");
    }
    const migrated: ProjectionWithVersion = {
      ...state,
      schedulerVersion: target.version,
      schedulerParametersVersion: target.parametersVersion,
    };
    const snapshot = projectionSnapshot(migrated);
    await transaction.schedulerMigrationCheckpoint.upsert({
      where: {
        userId_learningCardId_toSchedulerVersion: {
          userId,
          learningCardId,
          toSchedulerVersion: target.version,
        },
      },
      create: {
        userId,
        learningCardId,
        fromSchedulerVersion: state.schedulerVersion,
        toSchedulerVersion: target.version,
        cutoffEffectiveOccurredAt: cutoff.effectiveOccurredAt,
        cutoffEventId: cutoff.id,
        migratedState: snapshot,
        stateChecksum: checksum(snapshot),
      },
      update: {
        fromSchedulerVersion: state.schedulerVersion,
        cutoffEffectiveOccurredAt: cutoff.effectiveOccurredAt,
        cutoffEventId: cutoff.id,
        migratedState: snapshot,
        stateChecksum: checksum(snapshot),
      },
    });
    return migrated;
  }
}
