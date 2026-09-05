import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AppleStoreConfig } from "./apple/apple-store.config";
import { AppleTransactionVerifier } from "./apple/apple-transaction-verifier";
import {
  AppleTransactionsController,
  CommerceOffersController,
  EntitlementsController,
} from "./commerce.controller";
import { DeckAccessService } from "./deck-access.service";
import { EntitlementService } from "./entitlement.service";
import { OffersService } from "./offers.service";

/**
 * Everything about what an account may open, and how it came to be allowed
 * to. The guard lives here rather than inside the content module because
 * study sessions need the same answer, and two copies of an access rule are
 * one copy too many.
 *
 * The Apple SDK is reached only through `apple/`, so the rest of the module —
 * and everything that depends on it — works with a verified purchase rather
 * than with a JWS.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    CommerceOffersController,
    EntitlementsController,
    AppleTransactionsController,
  ],
  providers: [
    AppleStoreConfig,
    AppleTransactionVerifier,
    DeckAccessService,
    EntitlementService,
    OffersService,
  ],
  exports: [DeckAccessService, EntitlementService],
})
export class CommerceModule {}
