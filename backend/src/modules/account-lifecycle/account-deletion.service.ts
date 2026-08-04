import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";

interface DeletionResult extends Record<string, unknown> {
  status: "DELETION_PENDING";
  requestedAt: string;
  expectedCompletionAt: string;
}

@Injectable()
export class AccountDeletionService {
  constructor(private readonly database: PrismaService) {}

  async delete(userId: string, requestId: string): Promise<DeletionResult> {
    return this.database.$transaction(
      async (transaction) => {
        const user = await transaction.user.findUnique({
          where: { id: userId },
        });
        if (user === null) {
          throw new ApiException(
            HttpStatus.UNAUTHORIZED,
            "ACCOUNT_UNAVAILABLE",
            "The account is not available",
          );
        }
        if (
          user.status === UserStatus.DELETED &&
          user.deletionRequestedAt !== null &&
          user.deletedAt !== null
        ) {
          return this.result(user.deletionRequestedAt, user.deletedAt);
        }

        const now = new Date();
        const requestedAt = user.deletionRequestedAt ?? now;
        const providers = await transaction.authIdentity.findMany({
          where: { userId },
          select: { provider: true },
          distinct: ["provider"],
        });

        const deletedCounts: Record<string, number> = {};
        const remove = async (
          key: string,
          action: Promise<{ count: number }>,
        ): Promise<void> => {
          deletedCounts[key] = (await action).count;
        };

        await remove(
          "refreshSessions",
          transaction.refreshSession.deleteMany({ where: { userId } }),
        );
        await remove(
          "learningOutboxEvents",
          transaction.learningOutboxEvent.deleteMany({ where: { userId } }),
        );
        await remove(
          "userChanges",
          transaction.userChange.deleteMany({ where: { userId } }),
        );
        await remove(
          "schedulerCheckpoints",
          transaction.schedulerMigrationCheckpoint.deleteMany({
            where: { userId },
          }),
        );
        await remove(
          "reconciliationJobs",
          transaction.reconciliationJob.deleteMany({ where: { userId } }),
        );
        await remove(
          "userCardStates",
          transaction.userCardState.deleteMany({ where: { userId } }),
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
          "achievements",
          transaction.userAchievement.deleteMany({ where: { userId } }),
        );
        await remove(
          "deckMastery",
          transaction.userDeckMastery.deleteMany({ where: { userId } }),
        );
        await remove(
          "ownedDecks",
          transaction.deck.deleteMany({ where: { ownerUserId: userId } }),
        );
        await remove(
          "dataExports",
          transaction.dataExportRequest.deleteMany({ where: { userId } }),
        );
        await remove(
          "guestImports",
          transaction.guestImportOperation.deleteMany({ where: { userId } }),
        );
        await remove(
          "privacyEvents",
          transaction.privacyConsentEvent.deleteMany({ where: { userId } }),
        );
        await transaction.userPrivacySettings.deleteMany({
          where: { userId },
        });
        await transaction.userSettings.deleteMany({ where: { userId } });
        await remove(
          "identities",
          transaction.authIdentity.deleteMany({ where: { userId } }),
        );
        await remove(
          "devices",
          transaction.device.deleteMany({ where: { userId } }),
        );

        await transaction.user.update({
          where: { id: userId },
          data: {
            displayName: null,
            preferredLocale: "und",
            status: UserStatus.DELETED,
            deletionRequestedAt: requestedAt,
            deletedAt: now,
          },
        });
        await transaction.auditEvent.create({
          data: {
            actorUserId: userId,
            action: "ACCOUNT_DELETED",
            targetType: "USER",
            targetId: userId,
            requestId,
            metadata: {
              deletedCounts,
              identityProviders: providers.map(({ provider }) => provider),
              providerCredentialRevocation:
                "not_applicable_no_backend_provider_tokens",
              analyticsProviderDeletion: "not_configured",
            } satisfies Prisma.InputJsonValue,
          },
        });
        return this.result(requestedAt, now);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  private result(requestedAt: Date, completedAt: Date): DeletionResult {
    return {
      status: "DELETION_PENDING",
      requestedAt: requestedAt.toISOString(),
      expectedCompletionAt: completedAt.toISOString(),
    };
  }
}
