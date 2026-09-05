import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";

import { uuid } from "../../common/http/request-validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/admin-roles.guard";
import { parseCardCandidateQuery } from "./admin-drafts.request";
import { DraftCandidatesService } from "./draft-candidates.service";
import type { CardCandidatePage } from "./draft-candidates.service";

/**
 * The deck builder's card library.
 *
 * It is a read of the draft rather than of a deck, because the library is
 * where a card comes from before any deck holds it. Naming a deck narrows
 * the answer — a card that deck already holds is marked — but the search
 * itself is over everything the catalog could teach.
 */
@Controller("admin/content/drafts/:draftId/card-candidates")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
export class DraftCandidatesController {
  constructor(private readonly candidates: DraftCandidatesService) {}

  @Get()
  search(
    @Req() request: AdminAuthenticatedRequest,
    @Param("draftId") rawDraftId: string,
  ): Promise<CardCandidatePage> {
    return this.candidates.search(
      uuid(rawDraftId, "draftId"),
      parseCardCandidateQuery(request.query),
    );
  }
}
