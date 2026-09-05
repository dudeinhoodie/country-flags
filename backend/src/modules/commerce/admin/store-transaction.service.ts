import { HttpStatus, Injectable } from "@nestjs/common";
import { EntitlementGrantStatus } from "@prisma/client";
import type { StoreTransaction } from "@prisma/client";

import { ApiException } from "../../../common/http/api.exception";
import { PrismaService } from "../../../infrastructure/database/prisma.service";

/**
 * One purchase as support may see it.
 *
 * A support agent needs to answer "did the purchase land, and what did it
 * open" — nothing more. The signed payload never leaves the server, the
 * identifiers are masked in the response mapper, and the account behind the
 * purchase is not part of the answer: a console screenshot must not be a
 * receipt somebody else can present (17-paid-decks-storekit §16).
 */
@Injectable()
export class StoreTransactionService {
  constructor(private readonly database: PrismaService) {}

  async get(transactionId: string): Promise<{
    transaction: StoreTransaction;
    grantedEntitlementKeys: string[];
  }> {
    const transaction = await this.database.storeTransaction.findUnique({
      where: { id: transactionId },
    });
    if (transaction === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
      );
    }
    const grants = await this.database.userEntitlementGrant.findMany({
      where: {
        sourceTransactionId: transaction.id,
        status: EntitlementGrantStatus.ACTIVE,
      },
      select: { entitlementKey: true },
      orderBy: { entitlementKey: "asc" },
    });
    return {
      transaction,
      grantedEntitlementKeys: grants.map((grant) => grant.entitlementKey),
    };
  }
}
