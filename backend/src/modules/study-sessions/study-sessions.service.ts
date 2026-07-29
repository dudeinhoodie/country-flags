import { createHash } from "node:crypto";

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  CardStatus,
  DeckStatus,
  type Prisma,
  SchedulerDefinitionStatus,
  UserStatus,
} from "@prisma/client";

import { PrismaService } from "../../infrastructure/database/prisma.service";
import {
  type SessionCandidate,
  type SelectedCandidate,
  selectSessionCandidates,
} from "./session-selection";
import {
  type CreateServerStudySessionRequest,
  requestHash,
} from "./study-session.request";
import {
  CARD_SNAPSHOT_INCLUDE,
  buildLearningCardSnapshot,
} from "./study-session-snapshot";

const SESSION_INCLUDE = {
  cards: {
    orderBy: { initialOrder: "asc" },
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

@Injectable()
export class StudySessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
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
        const selected = selectSessionCandidates(
          memberships.map((membership) => ({
            ...membership,
            state: membership.learningCard.userStates[0] ?? null,
          })),
          request.requestedUniqueCount,
          request.id,
          now,
        );
        const defaultLocale = manifestDefaultLocale(pointer.release.metadata);

        await transaction.studySession.create({
          data: {
            id: request.id,
            userId,
            deckId: deck.id,
            mode: request.mode,
            selectionOrigin: request.selectionOrigin,
            requestedUniqueCount: request.requestedUniqueCount,
            selectedUniqueCount: selected.length,
            contentVersion: deck.contentVersion,
            schedulerVersion: scheduler.version,
            requestHash: hash,
            startedAt: now,
            cards: {
              create: selected.map((selection, index) =>
                this.sessionCardCreateData(
                  selection,
                  request,
                  defaultLocale,
                  index,
                ),
              ),
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
  ): Prisma.StudySessionCardCreateWithoutSessionInput {
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
    ) as Prisma.InputJsonObject;

    return {
      id: deterministicUuid(
        `${request.id}:${selection.candidate.learningCardId}`,
      ),
      learningCard: {
        connect: { id: selection.candidate.learningCardId },
      },
      learningCardRevision: {
        connect: { id: revision.id },
      },
      initialOrder,
      selectionReason: selection.reason,
      stateVersionAtSelection: selection.candidate.state?.stateVersion ?? null,
      distractorPolicyVersion: null,
      randomSeed: deterministicValue(
        `${request.id}:${selection.candidate.learningCardId}:random`,
      ),
      snapshot,
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
      })),
      summary: session.summary,
      serverTime: new Date().toISOString(),
    };
  }
}
