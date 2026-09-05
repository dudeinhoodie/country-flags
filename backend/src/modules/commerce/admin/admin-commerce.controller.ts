import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminRole } from "@prisma/client";

import { uuid } from "../../../common/http/request-validation";
import type { EnvironmentVariables } from "../../../config/environment.validation";
import { AdminAuthGuard } from "../../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../../admin-auth/admin-auth.guard";
import { assertTrustedAdminOrigin } from "../../admin-auth/admin-origin";
import { RequireAdminRole } from "../../admin-auth/admin-roles";
import { AdminRolesGuard } from "../../admin-auth/admin-roles.guard";
import {
  parseEntitlementCreateRequest,
  parseOfferCreateRequest,
  parseOfferUpdateRequest,
  parseStoreProductCreateRequest,
  parseStoreProductUpdateRequest,
} from "./admin-commerce.request";
import {
  apiEntitlement,
  apiOffer,
  apiStoreProduct,
  apiStoreSyncRun,
  apiStoreTransaction,
} from "./admin-commerce.response";
import { AdminCommerceService } from "./admin-commerce.service";
import { StoreSyncRunService } from "./store-sync-run.service";
import { StoreTransactionService } from "./store-transaction.service";

/**
 * The commerce mapping as the console reads and edits it.
 *
 * Three things this controller cannot do, by construction rather than by
 * convention: it cannot create an in-app purchase, it cannot set a price,
 * and it cannot reach App Store Connect. The store owns all three, and the
 * key that would let a request touch them belongs to a job
 * (17-paid-decks-storekit §12.4).
 *
 * Roles follow §7.5: reading offers and status is open to every
 * authenticated admin, drafting an offer is an `EDITOR`'s, putting one on
 * sale and mapping a product are a `PUBLISHER`'s, and running a sync or
 * reading a transaction are an `ADMIN`'s. The guard decides, not the menu.
 */
@Controller("admin/commerce")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class AdminCommerceController {
  constructor(
    private readonly commerce: AdminCommerceService,
    private readonly syncRuns: StoreSyncRunService,
    private readonly transactions: StoreTransactionService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  @Get("status")
  async status(): Promise<Record<string, unknown>> {
    return this.commerce.status();
  }

  @Get("entitlements")
  async listEntitlements(): Promise<Record<string, unknown>> {
    const { entitlements, deckCodesByKey } =
      await this.commerce.listEntitlements();
    return {
      items: entitlements.map((entitlement) =>
        apiEntitlement(entitlement, deckCodesByKey.get(entitlement.key) ?? []),
      ),
      total: entitlements.length,
    };
  }

  @Post("entitlements")
  @RequireAdminRole(AdminRole.PUBLISHER)
  @HttpCode(HttpStatus.CREATED)
  async createEntitlement(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    const created = await this.commerce.createEntitlement(
      request.adminUser,
      parseEntitlementCreateRequest(body),
      request.requestId,
    );
    // Nothing requires a key the moment it is declared.
    return apiEntitlement(created, []);
  }

  @Get("offers")
  async listOffers(): Promise<Record<string, unknown>> {
    const offers = await this.commerce.listOffers();
    return { items: offers.map(apiOffer), total: offers.length };
  }

  @Post("offers")
  @RequireAdminRole(AdminRole.EDITOR)
  @HttpCode(HttpStatus.CREATED)
  async createOffer(
    @Req() request: AdminAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    return apiOffer(
      await this.commerce.createOffer(
        request.adminUser,
        parseOfferCreateRequest(body),
        request.requestId,
      ),
    );
  }

  @Get("offers/:offerId")
  async getOffer(
    @Param("offerId") rawOfferId: string,
  ): Promise<Record<string, unknown>> {
    return apiOffer(await this.commerce.getOffer(uuid(rawOfferId, "offerId")));
  }

  /**
   * `EDITOR` is the floor because copy and sort order are an editor's. The
   * steps that are a publisher's — activation, retirement, and widening the
   * grants of something already on sale — are refused in the service, which
   * is the only place that can see which of them a request is asking for.
   */
  @Patch("offers/:offerId")
  @RequireAdminRole(AdminRole.EDITOR)
  async updateOffer(
    @Req() request: AdminAuthenticatedRequest,
    @Param("offerId") rawOfferId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    return apiOffer(
      await this.commerce.updateOffer(
        request.adminUser,
        uuid(rawOfferId, "offerId"),
        parseOfferUpdateRequest(body),
        request.requestId,
      ),
    );
  }

  @Post("offers/:offerId/products")
  @RequireAdminRole(AdminRole.PUBLISHER)
  @HttpCode(HttpStatus.CREATED)
  async createProduct(
    @Req() request: AdminAuthenticatedRequest,
    @Param("offerId") rawOfferId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    return apiStoreProduct(
      await this.commerce.createProduct(
        request.adminUser,
        uuid(rawOfferId, "offerId"),
        parseStoreProductCreateRequest(body),
        request.requestId,
      ),
    );
  }

  @Patch("products/:productId")
  @RequireAdminRole(AdminRole.PUBLISHER)
  async updateProduct(
    @Req() request: AdminAuthenticatedRequest,
    @Param("productId") rawProductId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    return apiStoreProduct(
      await this.commerce.updateProduct(
        request.adminUser,
        uuid(rawProductId, "productId"),
        parseStoreProductUpdateRequest(body),
        request.requestId,
      ),
    );
  }

  @Post("store-sync-runs")
  @RequireAdminRole(AdminRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  async startStoreSyncRun(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    this.assertConsoleOrigin(request);
    return apiStoreSyncRun(
      await this.syncRuns.start(request.adminUser, request.requestId),
    );
  }

  /// Watching a sync is not the same permission as starting one.
  @Get("store-sync-runs/:runId")
  async getStoreSyncRun(
    @Param("runId") rawRunId: string,
  ): Promise<Record<string, unknown>> {
    return apiStoreSyncRun(await this.syncRuns.get(uuid(rawRunId, "runId")));
  }

  @Get("transactions/:transactionId")
  @RequireAdminRole(AdminRole.ADMIN)
  async getStoreTransaction(
    @Param("transactionId") rawTransactionId: string,
  ): Promise<Record<string, unknown>> {
    const { transaction, grantedEntitlementKeys } = await this.transactions.get(
      uuid(rawTransactionId, "transactionId"),
    );
    return apiStoreTransaction(transaction, grantedEntitlementKeys);
  }

  /// Every write here is a cross-site target worth refusing at the door: a
  /// page on another origin does not get to put something on sale.
  private assertConsoleOrigin(request: AdminAuthenticatedRequest): void {
    assertTrustedAdminOrigin(
      request,
      this.config.getOrThrow<string[]>("ADMIN_ALLOWED_ORIGINS"),
    );
  }
}
