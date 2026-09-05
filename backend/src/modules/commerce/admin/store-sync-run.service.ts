import { HttpStatus, Injectable } from "@nestjs/common";
import { StoreProvider, StoreSyncRunStatus } from "@prisma/client";
import type { AdminUser, StoreEnvironment, StoreSyncRun } from "@prisma/client";

import { ApiException } from "../../../common/http/api.exception";
import { PrismaService } from "../../../infrastructure/database/prisma.service";
import { AdminAuditService } from "../../admin-auth/admin-audit.service";

/**
 * Asking the store what it knows about the products we mapped.
 *
 * The run is queued, not performed. App Store Connect answers a key that
 * lives in Secret Manager and belongs to a job with its own service account
 * — deliberately not to the console and not to a browser session
 * (17-paid-decks-storekit §12.4). So this writes a row and returns, and the
 * job reports back into it.
 *
 * Read-only in both directions: the run may mark a product validated or
 * invalid, and it may not create an in-app purchase, change a price or edit
 * anything in App Store Connect. Nothing in the schema it writes to could
 * express a price if it wanted to.
 */
@Injectable()
export class StoreSyncRunService {
  constructor(
    private readonly database: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly storeEnvironment: StoreEnvironment,
  ) {}

  async get(runId: string): Promise<StoreSyncRun> {
    const run = await this.database.storeSyncRun.findUnique({
      where: { id: runId },
    });
    if (run === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "RESOURCE_NOT_FOUND",
        "The requested resource was not found",
      );
    }
    return run;
  }

  async start(actor: AdminUser, requestId: string): Promise<StoreSyncRun> {
    return this.database.$transaction(async (transaction) => {
      // The partial unique index refuses a second live run; this reads it
      // first only to answer with the run already under way rather than with
      // a constraint violation.
      const inFlight = await transaction.storeSyncRun.findFirst({
        where: {
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: this.storeEnvironment,
          status: {
            in: [StoreSyncRunStatus.QUEUED, StoreSyncRunStatus.RUNNING],
          },
        },
        select: { id: true },
      });
      if (inFlight !== null) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          "STORE_SYNC_RUN_IN_FLIGHT",
          "A store sync is already under way; wait for it to finish",
          { runId: inFlight.id },
        );
      }

      const created = await transaction.storeSyncRun.create({
        data: {
          provider: StoreProvider.APPLE_APP_STORE,
          storeEnvironment: this.storeEnvironment,
          requestedByAdminUserId: actor.id,
        },
      });
      await this.audit.record(transaction, {
        actorAdminUserId: actor.id,
        action: "admin.commerce.store_sync_queued",
        targetType: "store_sync_run",
        targetId: created.id,
        requestId,
        metadata: { storeEnvironment: this.storeEnvironment },
      });
      return created;
    });
  }
}
