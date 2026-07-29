import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";

import type { RequestWithId } from "../../common/http/request-id.middleware";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { parseUpdateUserRequest } from "./user.request";
import { UsersService } from "./users.service";

type PrivateRequest = RequestWithId & AuthenticatedRequest;

@Controller("me")
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@Req() request: PrivateRequest): Promise<Record<string, unknown>> {
    return this.users.get(request.authenticatedUserId);
  }

  @Patch()
  update(
    @Req() request: PrivateRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.users.update(
      request.authenticatedUserId,
      parseUpdateUserRequest(body),
      request.requestId,
    );
  }
}
