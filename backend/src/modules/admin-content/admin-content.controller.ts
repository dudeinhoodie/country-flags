import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";

import {
  requiredString,
  uuid,
  validationError,
} from "../../common/http/request-validation";
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard";
import type { AdminAuthenticatedRequest } from "../admin-auth/admin-auth.guard";
import { parseAdminListQuery } from "../admin-auth/admin-users.request";
import { AdminContentService } from "./admin-content.service";

function parseSearch(query: unknown): string | undefined {
  if (typeof query !== "object" || query === null) {
    return undefined;
  }
  const value = (query as Record<string, unknown>).q;
  if (value === undefined) {
    return undefined;
  }
  const search = requiredString(value, "q", 1, 200).trim();
  if (search.length === 0) {
    validationError("q", "must not be blank");
  }
  return search;
}

/**
 * Read-only view over the ACTIVE release, open to every authenticated
 * admin (VIEWER is the floor). Nothing here can touch published tables.
 */
@Controller("admin/content")
@UseGuards(AdminAuthGuard)
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get("status")
  status(): Promise<Record<string, unknown>> {
    return this.content.status();
  }

  @Get("entities")
  listEntities(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    const { offset, limit } = parseAdminListQuery(request.query);
    return this.content.listEntities(offset, limit, parseSearch(request.query));
  }

  @Get("entities/:entityId")
  getEntity(
    @Param("entityId") rawEntityId: string,
  ): Promise<Record<string, unknown>> {
    return this.content.getEntity(uuid(rawEntityId, "entityId"));
  }

  @Get("decks")
  listDecks(
    @Req() request: AdminAuthenticatedRequest,
  ): Promise<Record<string, unknown>> {
    const { offset, limit } = parseAdminListQuery(request.query);
    return this.content.listDecks(offset, limit);
  }

  @Get("decks/:deckId")
  getDeck(
    @Param("deckId") rawDeckId: string,
  ): Promise<Record<string, unknown>> {
    return this.content.getDeck(uuid(rawDeckId, "deckId"));
  }
}
