import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";

export interface ProgressDeletionResult extends Record<string, unknown> {
  operationId: string;
  status: "COMPLETED";
  requestedAt: string;
}

@Injectable()
export class ProgressDeletionService {
  constructor(private readonly database: PrismaService) {}

  async delete(
    userId: string,
    requestId: string,
  ): Promise<ProgressDeletionResult> {
    const operationId = randomUUID();
    const requestedAt = new Date();

    await this.database.$transaction(
      async (transaction) => {
        const user = await transaction.user.findFirst({
          where: { id: userId, status: UserStatus.ACTIVE },
          select: { id: true },
        });
        if (user === null) {
          throw new ApiException(
            HttpStatus.UNAUTHORIZED,
            "ACCOUNT_UNAVAILABLE",
            "The account is not available",
          );
        }

        const deletedCounts: Record<string, number> = {};
        const remove = async (
          key: string,
          action: Promise<{ count: number }>,
        ): Promise<void> => {
          deletedCounts[key] = (await action).count;
        };

        // Pending projection work first: it references the review history that
        // the following statements remove.
        await remove(
          "learningOutboxEvents",
          transaction.learningOutboxEvent.deleteMany({ where: { userId } }),
        );
        await remove(
          "reconciliationJobs",
          transaction.reconciliationJob.deleteMany({ where: { userId } }),
        );
        await remove(
          "schedulerCheckpoints",
          transaction.schedulerMigrationCheckpoint.deleteMany({
            where: { userId },
          }),
        );
        await remove(
          "reviewEvents",
          transaction.reviewEvent.deleteMany({ where: { userId } }),
        );
        await remove(
          "studySessions",
          transaction.studySession.deleteMany({ where: { userId } }),
        );
        await remove(
          "userCardStates",
          transaction.userCardState.deleteMany({ where: { userId } }),
        );
        await remove(
          "achievements",
          transaction.userAchievement.deleteMany({ where: { userId } }),
        );
        await remove(
          "deckMastery",
          transaction.userDeckMastery.deleteMany({ where: { userId } }),
        );
        await remove(
          "userChanges",
          transaction.userChange.deleteMany({ where: { userId } }),
        );

        // A single change stream cannot express "everything before this point
        // is gone" per resource, so the stream identity is rotated. Cursors
        // held by other devices stop validating and each device performs a
        // full progress resync instead of silently keeping deleted state.
        await transaction.user.update({
          where: { id: userId },
          data: { syncStreamId: randomUUID() },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: userId,
            action: "ACCOUNT_PROGRESS_DELETED",
            targetType: "USER",
            targetId: userId,
            requestId,
            metadata: {
              operationId,
              deletedCounts,
              syncStreamRotated: true,
            } satisfies Prisma.InputJsonValue,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    return {
      operationId,
      status: "COMPLETED",
      requestedAt: requestedAt.toISOString(),
    };
  }
}
