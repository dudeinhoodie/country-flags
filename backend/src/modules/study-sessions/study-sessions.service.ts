import { createHash } from "node:crypto";

import {
  ConflictException,
  Injectable,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  AnswerMode,
  CardStatus,
  ContentReleaseStatus,
  DeckStatus,
  GeoEntityStatus,
  type Prisma,
  SchedulerDefinitionStatus,
  SelectionOrigin,
  StudySessionStatus,
  UserStatus,
} from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { generateMultipleChoiceOptions } from "./multiple-choice-options";
import {
  type SessionCandidate,
  type SelectedCandidate,
  isDue,
  selectSessionCandidates,
  selectionReasonFor,
} from "./session-selection";
import {
  buildSessionSummary,
  effectiveCompletedAt,
  effectiveStartedAt,
} from "./session-summary";
import {
  type CompleteStudySessionRequest,
  type CreateOfflineStudySessionRequest,
  type CreateServerStudySessionRequest,
  type CreateStudySessionRequest,
  requestHash,
} from "./study-session.request";
import {
  CARD_SNAPSHOT_ALL_REVISIONS_INCLUDE,
  CARD_SNAPSHOT_INCLUDE,
  buildLearningCardSnapshot,
  pinRevision,
} from "./study-session-snapshot";

const SESSION_INCLUDE = {
  cards: {
    orderBy: { initialOrder: "asc" },
    include: {
      options: {
        orderBy: { position: "asc" },
      },
    },
  },
} satisfies Prisma.StudySessionInclude;

type SessionWithCards = Prisma.StudySessionGetPayload<{
  include: typeof SESSION_INCLUDE;
}>;

function deterministicValue(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

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

function manifestDefaultLocale(metadata: Prisma.JsonValue): string {
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    "manifest" in metadata &&
    typeof metadata.manifest === "object" &&
    metadata.manifest !== null &&
    !Array.isArray(metadata.manifest) &&
    "defaultLocale" in metadata.manifest &&
    typeof metadata.manifest.defaultLocale === "string"
  ) {
    return metadata.manifest.defaultLocale;
  }
  throw new Error("Active content release has no default locale");
}

type OfflineCardRejectionReason =
  | "NOT_IN_DECK"
  | "RETIRED"
  | "REVISION_UNKNOWN"
  | "ASSET_MISMATCH";

interface OfflineCardRejection {
  learningCardId: string;
  reason: OfflineCardRejectionReason;
}

function optionDisplayName(snapshot: Prisma.JsonValue): string {
  if (
    typeof snapshot === "object" &&
    snapshot !== null &&
    !Array.isArray(snapshot) &&
    "displayName" in snapshot &&
    typeof snapshot.displayName === "string"
  ) {
    return snapshot.displayName;
  }
  throw new Error("Study option snapshot has no display name");
}

@Injectable()
export class StudySessionsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    request: CreateStudySessionRequest,
  ): Promise<{ created: boolean; session: Record<string, unknown> }> {
    return request.selectionOrigin === SelectionOrigin.SERVER
      ? this.createServerSession(userId, request)
      : this.importOfflineSession(userId, request);
  }

  private async createServerSession(
    userId: string,
    request: CreateServerStudySessionRequest,
  ): Promise<{ created: boolean; session: Record<string, unknown> }> {
    const hash = requestHash(request);
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.studySession.findUnique({
          where: { id: request.id },
          include: SESSION_INCLUDE,
        });
        if (existing !== null) {
          if (existing.userId !== userId || existing.requestHash !== hash) {
            throw new ConflictException(
              "Session ID was already used with another request",
            );
          }
          return { created: false, session: existing };
        }

        const [user, deck, scheduler, pointer] = await Promise.all([
          transaction.user.findFirst({
            where: { id: userId, status: UserStatus.ACTIVE },
            select: { id: true },
          }),
          transaction.deck.findFirst({
            where: { id: request.deckId, status: DeckStatus.PUBLISHED },
            select: { id: true, contentVersion: true },
          }),
          transaction.schedulerDefinition.findFirst({
            where: { status: SchedulerDefinitionStatus.ACTIVE },
            orderBy: [{ activeFrom: "desc" }, { version: "asc" }],
          }),
          transaction.contentPointer.findUnique({
            where: { key: "active" },
            include: { release: true },
          }),
        ]);
        if (user === null) {
          throw new UnauthorizedException("Test user is not active");
        }
        if (deck === null) {
          throw new NotFoundException("Deck was not found");
        }
        if (scheduler === null) {
          throw new ServiceUnavailableException(
            "No active scheduler definition is available",
          );
        }
        if (pointer === null) {
          throw new ServiceUnavailableException(
            "No active content release is available",
          );
        }

        const memberships = await transaction.deckCard.findMany({
          where: {
            deckId: deck.id,
            learningCard: { status: CardStatus.ACTIVE },
          },
          orderBy: [
            { sortOrder: { sort: "asc", nulls: "last" } },
            { learningCardId: "asc" },
          ],
          include: {
            learningCard: {
              include: {
                ...CARD_SNAPSHOT_INCLUDE,
                userStates: {
                  where: { userId },
                  take: 1,
                },
              },
            },
          },
        });
        const now = new Date();
        const candidates = memberships.map((membership) => ({
          ...membership,
          state: membership.learningCard.userStates[0] ?? null,
        }));
        // DUE_ONLY narrows the pool before ranking: the session holds what
        // the schedule owes and nothing else, however few that is.
        const pool =
          request.composition === "DUE_ONLY"
            ? candidates.filter((candidate) => isDue(candidate, now))
            : candidates;
        const ranked = selectSessionCandidates(
          pool,
          request.mode === AnswerMode.MULTIPLE_CHOICE
            ? pool.length
            : request.requestedUniqueCount,
          request.id,
          now,
        );
        const defaultLocale = manifestDefaultLocale(pointer.release.metadata);
        const distractorPool =
          request.mode === AnswerMode.MULTIPLE_CHOICE
            ? await transaction.geoEntity.findMany({
                where: {
                  status: GeoEntityStatus.ACTIVE,
                  includeInCountryCatalog: true,
                  contentVersion: deck.contentVersion,
                },
                orderBy: { id: "asc" },
                include: { names: true },
              })
            : [];
        const cards: Prisma.StudySessionCardCreateWithoutSessionInput[] = [];
        for (const selection of ranked) {
          const card = this.sessionCardCreateData(
            selection,
            request,
            defaultLocale,
            cards.length,
            distractorPool,
            deck.contentVersion,
          );
          if (card !== null) {
            cards.push(card);
          }
          if (cards.length === request.requestedUniqueCount) {
            break;
          }
        }
        if (
          request.mode === AnswerMode.MULTIPLE_CHOICE &&
          ranked.length > 0 &&
          cards.length === 0
        ) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "DISTRACTOR_POOL_INSUFFICIENT",
            "No card has three unique localized distractors",
            {
              requestedUniqueCount: request.requestedUniqueCount,
              poolVersion: deck.contentVersion,
            },
          );
        }

        await transaction.studySession.create({
          data: {
            id: request.id,
            userId,
            deckId: deck.id,
            mode: request.mode,
            selectionOrigin: request.selectionOrigin,
            requestedUniqueCount: request.requestedUniqueCount,
            selectedUniqueCount: cards.length,
            contentVersion: deck.contentVersion,
            schedulerVersion: scheduler.version,
            requestHash: hash,
            startedAt: now,
            cards: {
              create: cards,
            },
          },
        });
        const created = await transaction.studySession.findUniqueOrThrow({
          where: { id: request.id },
          include: SESSION_INCLUDE,
        });

        return { created: true, session: created };
      },
      {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    return {
      created: result.created,
      session: this.mapSession(result.session),
    };
  }

  /**
   * Imports a session a client assembled without network access. The client
   * composition is authoritative for identity, order and timing; everything a
   * client must not be trusted with — the card snapshot, the selection reason
   * and the scheduler version — is rebuilt from canonical content inside the
   * same serializable transaction, so a rejected composition can never leave a
   * partial session behind.
   */
  private async importOfflineSession(
    userId: string,
    request: CreateOfflineStudySessionRequest,
  ): Promise<{ created: boolean; session: Record<string, unknown> }> {
    const hash = requestHash(request);
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const existing = await transaction.studySession.findUnique({
          where: { id: request.id },
          include: SESSION_INCLUDE,
        });
        if (existing !== null) {
          if (existing.userId !== userId || existing.requestHash !== hash) {
            throw new ConflictException(
              "Session ID was already used with another request",
            );
          }
          return { created: false, session: existing };
        }

        const [user, deck, scheduler, release] = await Promise.all([
          transaction.user.findFirst({
            where: { id: userId, status: UserStatus.ACTIVE },
            select: { id: true },
          }),
          transaction.deck.findFirst({
            where: { id: request.deckId, status: DeckStatus.PUBLISHED },
            select: { id: true },
          }),
          transaction.schedulerDefinition.findFirst({
            where: { status: SchedulerDefinitionStatus.ACTIVE },
            orderBy: [{ activeFrom: "desc" }, { version: "asc" }],
          }),
          transaction.contentRelease.findFirst({
            where: {
              version: request.contentVersion,
              status: { not: ContentReleaseStatus.DRAFT },
            },
          }),
        ]);
        if (user === null) {
          throw new UnauthorizedException("Test user is not active");
        }
        if (deck === null) {
          throw new NotFoundException("Deck was not found");
        }
        if (scheduler === null) {
          throw new ServiceUnavailableException(
            "No active scheduler definition is available",
          );
        }
        // A superseded release stays importable: the session records what the
        // learner actually studied. Only a version the catalog never published
        // is refused, because nothing could reproduce its snapshots.
        if (release === null) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "CONTENT_VERSION_UNKNOWN",
            "The declared content version is not a published release",
            { contentVersion: request.contentVersion },
          );
        }

        const memberships = await transaction.deckCard.findMany({
          where: {
            deckId: deck.id,
            learningCardId: {
              in: request.cards.map((card) => card.learningCardId),
            },
          },
          include: {
            learningCard: {
              include: {
                ...CARD_SNAPSHOT_ALL_REVISIONS_INCLUDE,
                userStates: {
                  where: { userId },
                  take: 1,
                },
              },
            },
          },
        });
        const byLearningCardId = new Map(
          memberships.map((membership) => [
            membership.learningCardId,
            membership.learningCard,
          ]),
        );
        const defaultLocale = manifestDefaultLocale(release.metadata);
        const startedAt = effectiveStartedAt({
          clientStartedAt: request.startedAt,
          receivedAt: new Date(),
        });
        const rejections: OfflineCardRejection[] = [];
        const cards: Prisma.StudySessionCardCreateWithoutSessionInput[] = [];

        for (const [index, declared] of request.cards.entries()) {
          const card = byLearningCardId.get(declared.learningCardId);
          if (card === undefined) {
            rejections.push({
              learningCardId: declared.learningCardId,
              reason: "NOT_IN_DECK",
            });
            continue;
          }
          if (card.status !== CardStatus.ACTIVE) {
            rejections.push({
              learningCardId: declared.learningCardId,
              reason: "RETIRED",
            });
            continue;
          }
          const revision = card.revisions.find(
            (candidate) => candidate.revision === declared.learningCardRevision,
          );
          if (revision === undefined) {
            rejections.push({
              learningCardId: declared.learningCardId,
              reason: "REVISION_UNKNOWN",
            });
            continue;
          }
          // Any encoding the release publishes, not the vector alone. The
          // client caches whichever representation suits its screen — a raster
          // — and declares the checksum of what it actually downloaded, so
          // comparing against the vector's rejected every offline session with
          // `ASSET_MISMATCH` for a picture that was perfectly correct.
          const publishedChecksums = new Set(
            revision.promptAsset?.representations.map(
              (representation) => representation.sha256,
            ) ?? [],
          );
          if (!publishedChecksums.has(declared.assetSha256)) {
            rejections.push({
              learningCardId: declared.learningCardId,
              reason: "ASSET_MISMATCH",
            });
            continue;
          }

          const state = card.userStates[0] ?? null;
          cards.push({
            id: deterministicUuid(`${request.id}:${declared.learningCardId}`),
            learningCard: { connect: { id: declared.learningCardId } },
            learningCardRevision: { connect: { id: revision.id } },
            initialOrder: index,
            selectionReason: selectionReasonFor(
              { learningCardId: declared.learningCardId, state },
              startedAt,
            ),
            stateVersionAtSelection: state?.stateVersion ?? null,
            distractorPolicyVersion: null,
            randomSeed: declared.randomSeed,
            snapshot: buildLearningCardSnapshot(
              pinRevision(card, revision),
              request.locale,
              defaultLocale,
              AnswerMode.SELF_RATED,
            ) as Prisma.InputJsonObject,
          });
        }
        if (rejections.length > 0) {
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "OFFLINE_SESSION_COMPOSITION_INVALID",
            "The declared offline session composition is not importable",
            { cards: rejections },
          );
        }

        await transaction.studySession.create({
          data: {
            id: request.id,
            userId,
            deckId: deck.id,
            mode: request.mode,
            selectionOrigin: request.selectionOrigin,
            requestedUniqueCount: request.requestedUniqueCount,
            selectedUniqueCount: cards.length,
            contentVersion: release.version,
            schedulerVersion: scheduler.version,
            requestHash: hash,
            startedAt,
            cards: {
              create: cards,
            },
          },
        });
        const created = await transaction.studySession.findUniqueOrThrow({
          where: { id: request.id },
          include: SESSION_INCLUDE,
        });

        return { created: true, session: created };
      },
      {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    return {
      created: result.created,
      session: this.mapSession(result.session),
    };
  }

  async get(
    userId: string,
    sessionId: string,
  ): Promise<Record<string, unknown>> {
    const session = await this.prisma.studySession.findFirst({
      where: { id: sessionId, userId },
      include: SESSION_INCLUDE,
    });
    if (session === null) {
      throw new NotFoundException("Study session was not found");
    }

    return this.mapSession(session);
  }

  async complete(
    userId: string,
    sessionId: string,
    request: CompleteStudySessionRequest,
  ): Promise<Record<string, unknown>> {
    const session = await this.prisma.$transaction(
      async (transaction) => {
        const current = await transaction.studySession.findFirst({
          where: { id: sessionId, userId },
          include: SESSION_INCLUDE,
        });
        if (current === null) {
          throw new NotFoundException("Study session was not found");
        }
        // Completion is idempotent: the first accepted call fixes the canonical
        // summary, later retries observe it unchanged.
        if (current.status === StudySessionStatus.COMPLETED) {
          return current;
        }
        if (current.status !== StudySessionStatus.ACTIVE) {
          throw new ConflictException(
            "Study session is no longer active and cannot be completed",
          );
        }

        const events = await transaction.reviewEvent.findMany({
          where: { userId, sessionId },
          select: { learningCardId: true, rating: true, isCorrect: true },
        });
        const completedAt = effectiveCompletedAt({
          clientCompletedAt: request.completedAt,
          startedAt: current.startedAt,
          receivedAt: new Date(),
        });
        const summary = buildSessionSummary({
          events,
          startedAt: current.startedAt,
          completedAt,
        });
        const updated = await transaction.studySession.updateMany({
          where: {
            id: sessionId,
            userId,
            status: StudySessionStatus.ACTIVE,
          },
          data: {
            status: StudySessionStatus.COMPLETED,
            completedAt,
            summary: summary satisfies Prisma.InputJsonObject,
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            "Study session was completed concurrently",
          );
        }

        return transaction.studySession.findUniqueOrThrow({
          where: { id: sessionId },
          include: SESSION_INCLUDE,
        });
      },
      {
        isolationLevel: "Serializable",
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    return this.mapSession(session);
  }

  private sessionCardCreateData<
    T extends SessionCandidate & {
      learningCardId: string;
      learningCard: Parameters<typeof buildLearningCardSnapshot>[0] & {
        userStates: Array<{ stateVersion: number }>;
      };
    },
  >(
    selection: SelectedCandidate<T>,
    request: CreateServerStudySessionRequest,
    defaultLocale: string,
    initialOrder: number,
    distractorPool: Parameters<typeof generateMultipleChoiceOptions>[0]["pool"],
    poolVersion: string,
  ): Prisma.StudySessionCardCreateWithoutSessionInput | null {
    const revision = selection.candidate.learningCard.revisions[0];
    if (revision === undefined) {
      throw new Error(
        `Learning card ${selection.candidate.learningCardId} has no active revision`,
      );
    }
    const snapshot = buildLearningCardSnapshot(
      selection.candidate.learningCard,
      request.locale,
      defaultLocale,
      request.mode,
    ) as Prisma.InputJsonObject;
    const sessionCardId = deterministicUuid(
      `${request.id}:${selection.candidate.learningCardId}`,
    );
    const randomSeed = deterministicValue(
      `${request.id}:${selection.candidate.learningCardId}:random`,
    );
    const optionSet =
      request.mode === AnswerMode.MULTIPLE_CHOICE
        ? generateMultipleChoiceOptions({
            sessionCardId,
            correctEntityId: selection.candidate.learningCard.subjectEntityId,
            correctEntityKind: selection.candidate.learningCard.subject.kind,
            requestedLocale: request.locale,
            defaultLocale,
            randomSeed,
            poolVersion,
            pool: distractorPool,
          })
        : null;
    if (request.mode === AnswerMode.MULTIPLE_CHOICE && optionSet === null) {
      return null;
    }

    return {
      id: sessionCardId,
      learningCard: {
        connect: { id: selection.candidate.learningCardId },
      },
      learningCardRevision: {
        connect: { id: revision.id },
      },
      initialOrder,
      selectionReason: selection.reason,
      stateVersionAtSelection: selection.candidate.state?.stateVersion ?? null,
      distractorPolicyVersion: optionSet?.distractorPolicyVersion ?? null,
      randomSeed,
      snapshot,
      ...(optionSet === null
        ? {}
        : {
            options: {
              create: optionSet.options.map((option) => ({
                id: option.id,
                position: option.position,
                answerEntity: { connect: { id: option.answerEntityId } },
                displaySnapshot: option.displaySnapshot,
                isCorrect: option.isCorrect,
              })),
            },
          }),
    };
  }

  private mapSession(session: SessionWithCards): Record<string, unknown> {
    return {
      id: session.id,
      deckId: session.deckId,
      mode: session.mode,
      selectionOrigin: session.selectionOrigin,
      requestedUniqueCount: session.requestedUniqueCount,
      selectedUniqueCount: session.selectedUniqueCount,
      status: session.status,
      contentVersion: session.contentVersion,
      schedulerVersion: session.schedulerVersion,
      startedAt: session.startedAt.toISOString(),
      completedAt:
        session.completedAt === null ? null : session.completedAt.toISOString(),
      cards: session.cards.map((card) => ({
        id: card.id,
        learningCard: card.snapshot,
        initialOrder: card.initialOrder,
        selectionReason: card.selectionReason,
        randomSeed: card.randomSeed,
        distractorPolicyVersion: card.distractorPolicyVersion,
        ...(card.options.length === 0
          ? {}
          : {
              options: card.options.map((option) => ({
                id: option.id,
                position: option.position,
                displayName: optionDisplayName(option.displaySnapshot),
              })),
            }),
      })),
      // An unfinished session omits the summary instead of sending null: the
      // contract types it as a structured object so generated clients keep it.
      ...(session.summary === null || session.summary === undefined
        ? {}
        : { summary: session.summary }),
      serverTime: new Date().toISOString(),
    };
  }
}
