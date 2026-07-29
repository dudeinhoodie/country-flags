import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";

import { uuid } from "../../common/http/request-validation";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { DevicesService } from "./devices.service";

type PrivateRequest = RequestWithId & AuthenticatedRequest;

@Controller("me/devices")
@UseGuards(AuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(@Req() request: PrivateRequest): Promise<Record<string, unknown>> {
    return this.devices.list(
      request.authenticatedUserId,
      request.authenticatedSessionId,
    );
  }

  @Delete(":deviceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Req() request: PrivateRequest,
    @Param("deviceId") deviceId: string,
  ): Promise<void> {
    return this.devices.delete(
      request.authenticatedUserId,
      uuid(deviceId, "deviceId"),
      request.requestId,
    );
  }
}
