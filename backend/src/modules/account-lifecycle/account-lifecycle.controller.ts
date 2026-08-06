import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import { ApiException } from "../../common/http/api.exception";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { requiredString, uuid } from "../../common/http/request-validation";
import { RateLimiter } from "../../common/security/rate-limiter.service";
import { AuthGuard, type AuthenticatedRequest } from "../auth/auth.guard";
import { ReauthenticationTokenService } from "../auth/reauthentication-token.service";
import { AccountDeletionService } from "./account-deletion.service";
import { DataExportsService } from "./data-exports.service";
import { parseGuestImportRequest } from "./guest-import.request";
import { GuestImportsService } from "./guest-imports.service";

type PrivateRequest = RequestWithId & AuthenticatedRequest;

function currentSessionId(request: PrivateRequest): string {
  if (request.authenticatedSessionId === null) {
    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      "SESSION_ACCESS_TOKEN_REQUIRED",
      "A session access token is required for this operation",
    );
  }
  return request.authenticatedSessionId;
}

@Controller("me/guest-imports")
@UseGuards(AuthGuard)
export class GuestImportsController {
  constructor(
    private readonly imports: GuestImportsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Req() request: PrivateRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    await this.rateLimiter.consume(
      "account:guest-import",
      request.authenticatedUserId,
      10,
    );
    return this.imports.create(
      request.authenticatedUserId,
      parseGuestImportRequest(body),
      request.requestId,
    );
  }

  @Get(":migrationId")
  async get(
    @Req() request: PrivateRequest,
    @Param("migrationId") migrationId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.imports.get(
      request.authenticatedUserId,
      uuid(migrationId, "migrationId"),
    );
    if (result === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "GUEST_IMPORT_NOT_FOUND",
        "The guest import was not found",
      );
    }
    return result;
  }
}

@Controller("me/data-exports")
@UseGuards(AuthGuard)
export class DataExportsController {
  constructor(
    private readonly exportsService: DataExportsService,
    private readonly reauthentication: ReauthenticationTokenService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Req() request: PrivateRequest,
    @Headers("x-reauthentication-token") proof: string | undefined,
  ): Promise<Record<string, unknown>> {
    await this.reauthentication.verify(
      proof,
      request.authenticatedUserId,
      currentSessionId(request),
    );
    await this.rateLimiter.consume(
      "account:data-export",
      request.authenticatedUserId,
      5,
    );
    return this.exportsService.create(
      request.authenticatedUserId,
      request.requestId,
    );
  }

  @Get(":exportId")
  async get(
    @Req() request: PrivateRequest,
    @Param("exportId") exportId: string,
  ): Promise<Record<string, unknown>> {
    const result = await this.exportsService.get(
      request.authenticatedUserId,
      uuid(exportId, "exportId"),
    );
    if (result === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "DATA_EXPORT_NOT_FOUND",
        "The data export was not found",
      );
    }
    return result;
  }
}

@Controller("data-exports")
export class DataExportDownloadsController {
  constructor(
    private readonly exportsService: DataExportsService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Get(":exportId/download")
  async download(
    @Req() request: RequestWithId,
    @Res() response: Response,
    @Param("exportId") exportId: string,
    @Query("token") token: unknown,
  ): Promise<void> {
    await this.rateLimiter.consume(
      "account:export-download",
      request.ip ?? "unknown-client",
      20,
    );
    const dataExport = await this.exportsService.download(
      uuid(exportId, "exportId"),
      requiredString(token, "token", 32, 256),
      request.requestId,
    );
    if (dataExport === null) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        "DATA_EXPORT_NOT_FOUND",
        "The data export is unavailable or expired",
      );
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader(
      "Digest",
      `sha-256=${Buffer.from(dataExport.sha256, "hex").toString("base64")}`,
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="country-flags-account-${dataExport.id}.json"`,
    );
    response.status(HttpStatus.OK).send(dataExport.payloadText);
  }
}

@Controller("me")
@UseGuards(AuthGuard)
export class AccountDeletionController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly reauthentication: ReauthenticationTokenService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  async delete(
    @Req() request: PrivateRequest,
    @Headers("x-reauthentication-token") proof: string | undefined,
  ): Promise<Record<string, unknown>> {
    await this.reauthentication.verify(
      proof,
      request.authenticatedUserId,
      currentSessionId(request),
    );
    await this.rateLimiter.consume(
      "account:delete",
      request.authenticatedUserId,
      3,
    );
    return this.deletion.delete(request.authenticatedUserId, request.requestId);
  }
}
