import { Module } from "@nestjs/common";

import { DeckAccessService } from "./deck-access.service";

/**
 * Everything about what an account may open, and later about how it came to
 * be allowed to. The guard lives here rather than inside the content module
 * because study sessions need the same answer, and two copies of an access
 * rule are one copy too many.
 */
@Module({
  providers: [DeckAccessService],
  exports: [DeckAccessService],
})
export class CommerceModule {}
