import { Injectable } from "@nestjs/common";
import {
  APIException,
  AppStoreServerAPIClient,
  Environment,
} from "@apple/app-store-server-library";
import { StoreEnvironment } from "@prisma/client";

import { AppleStoreConfig } from "./apple-store.config";

const APPLE_ENVIRONMENT: Record<StoreEnvironment, Environment> = {
  LOCAL_TEST: Environment.LOCAL_TESTING,
  SANDBOX: Environment.SANDBOX,
  PRODUCTION: Environment.PRODUCTION,
};

export interface AppleNotificationHistoryPage {
  /** The notifications Apple could not deliver, still signed. */
  signedPayloads: string[];
  paginationToken: string | null;
  hasMore: boolean;
}

/**
 * Asking Apple what it already tried to tell us.
 *
 * A separate client from the one that verifies signatures, and separate on
 * purpose: this one holds the App Store Server API key, which is the most
 * sensitive credential in the product and belongs to a job rather than to a
 * request. Nothing in the request path constructs it.
 *
 * Every method answers with signed payloads, never with decoded facts. What
 * comes back over HTTPS from Apple is still verified against Apple's root
 * certificates before anything believes it: a repair job that trusted a
 * response because it came from the right hostname would be a repair job
 * that could be phished.
 */
@Injectable()
export class AppleServerApiClient {
  private readonly client: AppStoreServerAPIClient | null;

  constructor(private readonly store: AppleStoreConfig) {
    this.client =
      store.configured && store.apiCredentialPresent
        ? new AppStoreServerAPIClient(
            store.privateKey,
            store.keyId,
            store.issuerId,
            store.bundleId,
            APPLE_ENVIRONMENT[store.storeEnvironment],
          )
        : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /**
   * The notifications Apple tried and failed to deliver, oldest window
   * first.
   *
   * `onlyFailures` is the whole point: a notification that reached the
   * endpoint is already a row here, and asking Apple to resend the entire
   * history every hour would spend the rate limit on things we know.
   */
  async failedNotifications(
    since: Date,
    until: Date,
    paginationToken: string | null,
  ): Promise<AppleNotificationHistoryPage> {
    const client = this.client;
    if (client === null) {
      throw new Error("The App Store Server API is not configured");
    }
    const response = await client.getNotificationHistory(paginationToken, {
      startDate: since.getTime(),
      endDate: until.getTime(),
      onlyFailures: true,
    });
    return {
      signedPayloads: (response.notificationHistory ?? []).flatMap((item) =>
        item.signedPayload === undefined ? [] : [item.signedPayload],
      ),
      paginationToken: response.paginationToken ?? null,
      hasMore: response.hasMore === true,
    };
  }

  /**
   * What Apple currently says about one transaction, signed.
   *
   * The answer to "did this actually get refunded" when a notification was
   * lost, and the one thing a support agent's reconcile button asks.
   */
  async transactionInfo(transactionId: string): Promise<string | null> {
    const client = this.client;
    if (client === null) {
      throw new Error("The App Store Server API is not configured");
    }
    try {
      const response = await client.getTransactionInfo(transactionId);
      return response.signedTransactionInfo ?? null;
    } catch (error) {
      // Apple answers 404 for a transaction it does not know, which is an
      // answer rather than a failure: the row is ours to quarantine.
      if (error instanceof APIException && error.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }
}
