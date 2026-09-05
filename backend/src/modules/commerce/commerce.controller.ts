import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import { ApiException } from "../../common/http/api.exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { JsonLoggerService } from "../../common/logging/json-logger.service";
import { MetricsService } from "../../common/telemetry/metrics.service";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { AppleNotificationService } from "./apple/apple-notification.service";
import { AppleNotificationVerifier } from "./apple/apple-notification-verifier";
import { AppleVerificationError } from "./apple/apple-verification.error";
import {
  parseAppleNotificationEnvelope,
  parseAppleTransactionSubmission,
  parseCommercePlatform,
  parseIdempotencyKey,
} from "./commerce.request";
import type { EntitlementSnapshot } from "./entitlement.service";
import { EntitlementService } from "./entitlement.service";
import { type CommerceOfferView, OffersService } from "./offers.service";

type PrivateRequest = RequestWithId & AuthenticatedRequest;

function serializeSnapshot(
  snapshot: EntitlementSnapshot,
): Record<string, unknown> {
  return {
    entitlementKeys: snapshot.entitlementKeys,
    checkedAt: snapshot.checkedAt.toISOString(),
  };
}

@Controller("commerce/offers")
export class CommerceOffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  async list(
    @Query("platform") platform: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ items: CommerceOfferView[] }> {
    const items = await this.offers.list(parseCommercePlatform(platform));
    // The same answer for everybody and cheap to reproduce, but short-lived:
    // activating an offer is how a paid deck becomes buyable, and an hour of
    // staleness there is an hour of a paywall with nothing behind it.
    response.setHeader("Cache-Control", "public, max-age=300");
    return { items };
  }
}

/**
 * The answer that decides.
 *
 * A client may unlock locally the moment StoreKit hands it a verified
 * transaction — that is what makes a purchase feel instant — but this is what
 * the server will enforce, and it is what a second device reads after a
 * restore.
 */
@Controller("me/entitlements")
@UseGuards(AuthGuard)
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get()
  async get(
    @Req() request: PrivateRequest,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown> | undefined> {
    const snapshot = await this.entitlements.snapshot(
      request.authenticatedUserId,
    );
    response.setHeader("ETag", snapshot.etag);
    // `no-cache` rather than `no-store`: this answer must be revalidated
    // every single time — it is what decides — but it is worth keeping,
    // because keeping it is what turns a foreground check into a 304. Never
    // in a shared cache: these are one account's rights.
    response.setHeader("Cache-Control", "private, no-cache");
    response.setHeader("Vary", "Authorization");
    if (ifNoneMatch === snapshot.etag) {
      response.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return serializeSnapshot(snapshot);
  }
}

/**
 * Where a purchase, the transaction listener and a restore all arrive.
 *
 * Nothing about what a transaction is worth is read from the body: no deck,
 * no offer code, no entitlement key, no price. The server reads the product
 * out of the signed payload and maps it through its own catalog.
 */
@Controller("me/commerce/apple/transactions")
@UseGuards(AuthGuard)
export class AppleTransactionsController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async submit(
    @Req() request: PrivateRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    parseIdempotencyKey(idempotencyKey);
    const snapshot = await this.entitlements.submitAppleTransactions(
      request.authenticatedUserId,
      parseAppleTransactionSubmission(body),
      request.requestId,
    );
    response.setHeader("ETag", snapshot.etag);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Vary", "Authorization");
    return serializeSnapshot(snapshot);
  }
}

/**
 * Where Apple talks to us unprompted, and the fast way a refund is learned.
 *
 * Unauthenticated by nature: the signature on the payload is the
 * authentication, and it is checked before anything is written down. The
 * answer is `202` for everything Apple could have meant — including a
 * notification about a product this deployment does not know, which is
 * recorded and quarantined rather than refused. Refusing would make Apple
 * retry it every hour for a day and change nothing.
 *
 * Only an unsigned or unreadable body is refused, because that is not a
 * notification at all.
 */
@Controller("commerce/apple/notifications")
export class AppleNotificationsController {
  constructor(
    private readonly verifier: AppleNotificationVerifier,
    private readonly notifications: AppleNotificationService,
    private readonly metrics: MetricsService,
    private readonly logger: JsonLoggerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Req() request: RequestWithId,
    @Body() body: unknown,
  ): Promise<void> {
    const signedPayload = parseAppleNotificationEnvelope(body);
    let notification;
    try {
      notification = await this.verifier.verify(signedPayload);
    } catch (error) {
      if (!(error instanceof AppleVerificationError)) {
        throw error;
      }
      this.metrics.recordStoreNotification("refused");
      // No uuid and no type: nothing in an unverified payload has been
      // established, so there is nothing here worth quoting back.
      this.logger.warn({
        message: "Store notification refused",
        event: "store_notification_refused",
        requestId: request.requestId,
        reason: error.code,
      });
      throw new ApiException(
        error.retryable
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.UNPROCESSABLE_ENTITY,
        "NOTIFICATION_VERIFICATION_FAILED",
        "The notification was not accepted",
        { reason: error.code },
      );
    }
    await this.notifications.receive(notification, request.requestId);
  }
}
