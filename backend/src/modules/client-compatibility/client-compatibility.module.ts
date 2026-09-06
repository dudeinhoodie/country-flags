import { Module } from "@nestjs/common";

import { ClientCompatibilityService } from "./client-compatibility.service";

/**
 * Whether a client build understands a contract. One service, one question,
 * and no database: everything it needs arrives in the request headers or was
 * read from the environment at startup.
 */
@Module({
  providers: [ClientCompatibilityService],
  exports: [ClientCompatibilityService],
})
export class ClientCompatibilityModule {}
