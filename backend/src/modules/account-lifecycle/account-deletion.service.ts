import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { inSerializableTransaction } from "../../infrastructure/database/serializable-transaction";
import { AppleTokenLifecycle } from "../auth/apple/apple-token-lifecycle.service";
import { EntitlementService } from "../commerce/entitlement.service";

interface DeletionResult extends Record<string, unknown> {
  status: "DELETION_PENDING";
  requestedAt: string;
  expectedCompletionAt: string;
}

@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly database: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly appleTokens: AppleTokenLifecycle,
  ) {}

  async delete(userId: string, requestId: string): Promise<DeletionResult> {
    const marked = await this.markDeletionPending(userId);
    try {
      return await this.erase(userId, requestId);
    } catch (error) {
      // Nothing was erased: the transaction rolled back whole. Handing the
      // account back lets its owner use it again and ask again, which a
      // DELETION_PENDING account cannot do — the auth guard admits only
      // active ones.
      if (marked) {
        await this.database.user.updateMany({
          where: { id: userId, status: UserStatus.DELETION_PENDING },
          data: { status: UserStatus.ACTIVE, deletionRequestedAt: null },
        });
      }
      throw error;
    }
  }

  private async erase(
    userId: string,
    requestId: string,
  ): Promise<DeletionResult> {
    // Apple is asked before the transaction, never inside it: a network call
    // would hold a serializable transaction open for as long as Apple takes,
    // and a retried transaction would ask again. The token lives on the
    // identity the transaction deletes, so this is also the last moment it
    // can be read. The deletion goes ahead whatever the answer; the audit
    // below records it (docs/01 §5.5).
    const appleIdentity = await this.database.authIdentity.findUnique({
      where: { userId_provider: { userId, provider: "APPLE" } },
      select: {
        providerSubject: true,
        providerTokenCiphertext: true,
        providerTokenClientId: true,
        providerTokenState: true,
      },
    });
    const appleRevocation = await this.appleTokens.revoke(
      appleIdentity,
      requestId,
    );
    return inSerializableTransaction(
      this.database,
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
        // Events still waiting for delivery carry the account identifier.
        // Deleted here, not left to their TTL, so nothing that names the
        // account is sent to an analytics provider after it is gone.
        await remove(
          "analyticsOutboxEvents",
          transaction.analyticsOutboxEvent.deleteMany({
            where: { analyticsSubjectId: userId },
          }),
        );
        // A non-consumable purchase belongs to the Apple Account that paid
        // for it, and that account outlives this one. The rights go; the
        // ledger row stays and is released, which is the only state a
        // verified restore may later bind to a new account from (§15.4).
        const purchases = await this.entitlements.releaseOnAccountDeletion(
          transaction,
          userId,
        );
        deletedCounts.entitlementGrants = purchases.entitlementGrants;
        deletedCounts.releasedStoreTransactions = purchases.storeTransactions;
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
              providerCredentialRevocation: appleRevocation.outcome,
              providerCredentialRevocationFailure: appleRevocation.failure,
              appleTokenExchange: appleIdentity?.providerTokenState ?? null,
              analyticsProviderDeletion: "not_configured",
            } satisfies Prisma.InputJsonValue,
          },
        });
        return this.result(requestedAt, now);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  /**
   * Stops new writes before the erasure starts (see `lockAccountForWrite`).
   *
   * Its own transaction, committed before the erasure begins: `FOR UPDATE`
   * waits for every write that holds the account, and a write that asks
   * afterwards sees DELETION_PENDING and is refused. The erasure's snapshot
   * is taken after this commits, so it sees everything those writes left
   * behind. Returns whether this call set the mark.
   */
  private async markDeletionPending(userId: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT 1 AS locked FROM users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      const marked = await transaction.user.updateMany({
        where: { id: userId, status: UserStatus.ACTIVE },
        data: {
          status: UserStatus.DELETION_PENDING,
          deletionRequestedAt: new Date(),
        },
      });
      return marked.count === 1;
    });
  }

  private result(requestedAt: Date, completedAt: Date): DeletionResult {
    return {
      status: "DELETION_PENDING",
      requestedAt: requestedAt.toISOString(),
      expectedCompletionAt: completedAt.toISOString(),
    };
  }
}
