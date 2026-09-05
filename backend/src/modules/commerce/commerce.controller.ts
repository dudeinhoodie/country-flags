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

import type { RequestWithId } from "../../common/http/request-id.middleware";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import {
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
