import { Injectable } from "@nestjs/common";
import { StoreProvider } from "@prisma/client";

import { JsonLoggerService } from "../../../common/logging/json-logger.service";
import { MetricsService } from "../../../common/telemetry/metrics.service";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { EntitlementService } from "../entitlement.service";
import { AppleNotificationService } from "./apple-notification.service";
import { AppleNotificationVerifier } from "./apple-notification-verifier";
import { AppleServerApiClient } from "./apple-server-api.client";
import { AppleTransactionVerifier } from "./apple-transaction-verifier";
import { AppleVerificationError } from "./apple-verification.error";

/**
 * How far back a run looks when it has never succeeded before.
 *
 * Apple keeps six months of notification history; a first run that asked for
 * all of it would spend its rate limit proving that nothing was missed. A day
 * is enough to cover a deployment that started this morning, and the cursor
 * covers everything after that.
 */
const FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * An overlap on every window, because Apple's history is indexed by the time
 * it tried to send rather than by the time we asked. Re-reading a few minutes
 * costs nothing: every notification is idempotent on its own uuid.
 */
const OVERLAP_MS = 5 * 60 * 1000;

/** The scope key this job keeps its place under. */
const SCOPE = "notification-history";

export interface ReconciliationOutcome {
  recovered: number;
  processed: number;
  quarantined: number;
  duplicates: number;
  pages: number;
}

/**
 * The slow path that catches what the fast one lost.
 *
 * Notifications get lost — Apple retries for a day and then stops, and a
 * refund nobody heard about is a customer studying a deck they no longer own.
 * Apple keeps the history, so this asks for exactly the ones it could not
 * deliver and feeds each through the same verification and the same
 * idempotent apply the endpoint uses. Nothing here is a second
 * implementation of what a notification means.
 *
 * The cursor lives in the database rather than in the job, so a crashed run
 * resumes where it stopped instead of starting from the beginning or, worse,
 * from now.
 */
@Injectable()
export class AppleReconciliationService {
  constructor(
    private readonly database: PrismaService,
    private readonly api: AppleServerApiClient,
    private readonly verifier: AppleNotificationVerifier,
    private readonly transactions: AppleTransactionVerifier,
    private readonly notifications: AppleNotificationService,
    private readonly entitlements: EntitlementService,
    private readonly logger: JsonLoggerService,
    private readonly metrics: MetricsService,
  ) {}

  get configured(): boolean {
    return this.api.configured;
  }

  /**
   * One sweep of the notifications Apple could not deliver.
   *
   * Answers with what it found rather than throwing on a payload it cannot
   * use: a single unreadable notification must not stop the run that would
   * have recovered the twelve after it.
   */
  async run(
    requestId: string,
    now = new Date(),
  ): Promise<ReconciliationOutcome> {
    if (!this.api.configured) {
      throw new Error(
        "The App Store Server API is not configured; reconciliation cannot run",
      );
    }
    const startedAt = Date.now();
    const state = await this.database.storeReconciliationState.findUnique({
      where: {
        provider_storeEnvironment_scopeKey: {
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: this.verifier.storeEnvironment,
          scopeKey: SCOPE,
        },
      },
      select: { lastSucceededAt: true, lastRevision: true },
    });
    const since = new Date(
      (state?.lastSucceededAt?.getTime() ?? now.getTime() - FIRST_WINDOW_MS) -
        OVERLAP_MS,
    );

    const outcome: ReconciliationOutcome = {
      recovered: 0,
      processed: 0,
      quarantined: 0,
      duplicates: 0,
      pages: 0,
    };

    try {
      let paginationToken = state?.lastRevision ?? null;
      for (;;) {
        const page = await this.api.failedNotifications(
          since,
          now,
          paginationToken,
        );
        outcome.pages += 1;
        outcome.recovered += page.signedPayloads.length;
        for (const signedPayload of page.signedPayloads) {
          await this.replay(signedPayload, requestId, outcome);
        }
        if (!page.hasMore || page.paginationToken === null) {
          break;
        }
        paginationToken = page.paginationToken;
        // The token is kept as we go: a run that dies on page nine resumes
        // on page nine rather than paying for the first eight again.
        await this.remember(now, paginationToken, null, false);
      }
      // A finished sweep starts the next one from this moment, and forgets
      // the page it was on.
      await this.remember(now, null, null, true);
      this.metrics.recordStoreReconciliation(
        "succeeded",
        (Date.now() - startedAt) / 1000,
      );
      this.logger.log({
        message: "Store reconciliation finished",
        event: "store_reconciliation_finished",
        requestId,
        ...outcome,
      });
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.remember(now, null, reason, false);
      this.metrics.recordStoreReconciliation(
        "failed",
        (Date.now() - startedAt) / 1000,
      );
      // Loud: the alert that matters here is "this has not succeeded in a
      // day", and a run that fails quietly is how that day passes.
      this.logger.error({
        message: "Store reconciliation failed",
        event: "store_reconciliation_failed",
        requestId,
        reason,
      });
      throw error;
    }
  }

  /**
   * One transaction, re-read from Apple and applied.
   *
   * The support answer to "the customer says they were refunded", and what
   * the console's reconcile button calls. Answers whether Apple still knows
   * the transaction at all.
   */
  async reconcileTransaction(
    transactionId: string,
    requestId: string,
  ): Promise<"applied" | "unknown_to_apple" | "not_usable"> {
    const signedTransaction = await this.api.transactionInfo(transactionId);
    if (signedTransaction === null) {
      return "unknown_to_apple";
    }
    // Wrapped as a notification of our own making so that one code path
    // decides what a transaction means, whoever asked for it.
    const outcome = await this.replayTransaction(
      signedTransaction,
      transactionId,
      requestId,
    );
    return outcome;
  }

  private async replay(
    signedPayload: string,
    requestId: string,
    outcome: ReconciliationOutcome,
  ): Promise<void> {
    let notification;
    try {
      notification = await this.verifier.verify(signedPayload);
    } catch (error) {
      if (!(error instanceof AppleVerificationError)) {
        throw error;
      }
      // Apple's own history handed us something that does not verify. That
      // is worth an alert and not worth stopping for.
      outcome.quarantined += 1;
      this.metrics.recordStoreNotification("refused");
      this.logger.warn({
        message: "Recovered notification refused",
        event: "store_reconciliation_refused",
        requestId,
        reason: error.code,
      });
      return;
    }
    const result = await this.notifications.receive(notification, requestId);
    if (result === "processed") {
      outcome.processed += 1;
    } else if (result === "duplicate") {
      outcome.duplicates += 1;
    } else {
      outcome.quarantined += 1;
    }
  }

  private async replayTransaction(
    signedTransaction: string,
    transactionId: string,
    requestId: string,
  ): Promise<"applied" | "not_usable"> {
    try {
      const purchase = await this.transactions.verify(signedTransaction);
      const applied = await this.entitlements.applyFromNotification(
        purchase,
        requestId,
      );
      return applied === "applied" ? "applied" : "not_usable";
    } catch (error) {
      if (!(error instanceof AppleVerificationError)) {
        throw error;
      }
      this.logger.warn({
        message: "Reconciled transaction refused",
        event: "store_reconciliation_transaction_refused",
        requestId,
        reason: error.code,
        transactionReference: transactionId.slice(-4).padStart(8, "*"),
      });
      return "not_usable";
    }
  }

  private async remember(
    now: Date,
    paginationToken: string | null,
    error: string | null,
    succeeded: boolean,
  ): Promise<void> {
    const identity = {
      provider: StoreProvider.APPLE_APP_STORE,
      storeEnvironment: this.verifier.storeEnvironment,
      scopeKey: SCOPE,
    };
    const data = {
      lastRevision: paginationToken,
      lastError: error,
      ...(succeeded ? { lastSucceededAt: now } : {}),
    };
    await this.database.storeReconciliationState.upsert({
      where: { provider_storeEnvironment_scopeKey: identity },
      create: { ...identity, ...data },
      update: data,
    });
  }
}
