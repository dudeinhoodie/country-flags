import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import { clientAddress } from "../../common/http/client-address";
import type { RequestWithId } from "../../common/http/request-id.middleware";
import { RateLimiter } from "../../common/security/rate-limiter.service";
import { ProviderIdentityVerifier } from "./provider-identity-verifier";
import { AuthService } from "./auth.service";
import { ReauthenticationTokenService } from "./reauthentication-token.service";
import {
  parseAppleAuthRequest,
  parseAppleIdentityLinkRequest,
  parseGoogleAuthRequest,
  parseGoogleIdentityLinkRequest,
  parseLogoutRequest,
  parseProvider,
  parseRefreshRequest,
} from "./auth.request";
import { AuthGuard, type AuthenticatedRequest } from "./auth.guard";

type PublicAuthRequest = RequestWithId;
type PrivateAuthRequest = RequestWithId & AuthenticatedRequest;

/** Refreshes per minute from one client address. */
const REFRESH_LIMIT_PER_ADDRESS = 60;
/** Refreshes per minute of one sign-in; a client needs one per access token. */
const REFRESH_LIMIT_PER_TOKEN_FAMILY = 10;

function requestContext(request: PublicAuthRequest): {
  requestId: string;
  ipAddress: string;
  userAgent: string | undefined;
} {
  return {
    requestId: request.requestId,
    ipAddress: clientAddress(request),
    userAgent: request.header("user-agent"),
  };
}

function sessionId(request: PrivateAuthRequest): string {
  if (request.authenticatedSessionId === null) {
    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      "SESSION_ACCESS_TOKEN_REQUIRED",
      "A session access token is required for this operation",
    );
  }
  return request.authenticatedSessionId;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly verifier: ProviderIdentityVerifier,
    private readonly rateLimiter: RateLimiter,
    private readonly reauthentication: ReauthenticationTokenService,
  ) {}

  @Post("apple")
  @HttpCode(HttpStatus.OK)
  async apple(
    @Req() request: PublicAuthRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    await this.rateLimiter.consume("auth:apple", clientAddress(request), 10);
    const parsed = parseAppleAuthRequest(body);
    let identity;
    try {
      identity = await this.verifier.verifyApple(
        parsed.identityToken,
        parsed.rawNonce,
      );
    } catch (error) {
      await this.auth.recordAuthenticationFailure("APPLE", request.requestId);
      throw error;
    }
    return this.auth.login(identity, parsed.device, requestContext(request));
  }

  @Post("google")
  @HttpCode(HttpStatus.OK)
  async google(
    @Req() request: PublicAuthRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    await this.rateLimiter.consume("auth:google", clientAddress(request), 10);
    const parsed = parseGoogleAuthRequest(body);
    let identity;
    try {
      identity = await this.verifier.verifyGoogle(parsed.idToken);
    } catch (error) {
      await this.auth.recordAuthenticationFailure("GOOGLE", request.requestId);
      throw error;
    }
    return this.auth.login(identity, parsed.device, requestContext(request));
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: PublicAuthRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    // The address is the outer layer: it bounds lookups of tokens that do
    // not exist, and it is shared by everyone behind the same carrier NAT,
    // so its budget is wider than the per-family one below.
    await this.rateLimiter.consume(
      "auth:refresh",
      clientAddress(request),
      REFRESH_LIMIT_PER_ADDRESS,
    );
    const refreshToken = parseRefreshRequest(body);
    // A family is one sign-in on one device, so this budget follows the
    // session wherever it refreshes from.
    const tokenFamilyId = await this.auth.refreshTokenFamily(refreshToken);
    if (tokenFamilyId !== null) {
      await this.rateLimiter.consume(
        "auth:refresh-family",
        tokenFamilyId,
        REFRESH_LIMIT_PER_TOKEN_FAMILY,
      );
    }
    return this.auth.rotateRefreshToken(refreshToken, requestContext(request));
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: PrivateAuthRequest,
    @Body() body: unknown,
  ): Promise<void> {
    await this.rateLimiter.consume(
      "auth:logout",
      request.authenticatedUserId,
      20,
    );
    await this.auth.logout(
      request.authenticatedUserId,
      sessionId(request),
      parseLogoutRequest(body),
      request.requestId,
    );
  }

  @Post("logout-all")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@Req() request: PrivateAuthRequest): Promise<void> {
    sessionId(request);
    await this.rateLimiter.consume(
      "auth:logout-all",
      request.authenticatedUserId,
      5,
    );
    return this.auth.logoutAll(request.authenticatedUserId, request.requestId);
  }

  @Post("reauth/apple")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async reauthenticateApple(
    @Req() request: PrivateAuthRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const currentSessionId = sessionId(request);
    await this.rateLimiter.consume(
      "auth:reauth",
      request.authenticatedUserId,
      10,
    );
    const parsed = parseAppleIdentityLinkRequest(body);
    const identity = await this.verifier.verifyApple(
      parsed.identityToken,
      parsed.rawNonce,
    );
    return this.reauthentication.issue(
      request.authenticatedUserId,
      currentSessionId,
      identity,
      request.requestId,
    );
  }

  @Post("reauth/google")
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async reauthenticateGoogle(
    @Req() request: PrivateAuthRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    const currentSessionId = sessionId(request);
    await this.rateLimiter.consume(
      "auth:reauth",
      request.authenticatedUserId,
      10,
    );
    const parsed = parseGoogleIdentityLinkRequest(body);
    const identity = await this.verifier.verifyGoogle(parsed.idToken);
    return this.reauthentication.issue(
      request.authenticatedUserId,
      currentSessionId,
      identity,
      request.requestId,
    );
  }
}

@Controller("me/identities")
@UseGuards(AuthGuard)
export class AuthIdentitiesController {
  constructor(
    private readonly auth: AuthService,
    private readonly verifier: ProviderIdentityVerifier,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Get()
  list(@Req() request: PrivateAuthRequest): Promise<Record<string, unknown>> {
    sessionId(request);
    return this.auth.listIdentities(request.authenticatedUserId);
  }

  @Post("apple")
  async linkApple(
    @Req() request: PrivateAuthRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    sessionId(request);
    await this.rateLimiter.consume(
      "auth:link",
      request.authenticatedUserId,
      10,
    );
    const parsed = parseAppleIdentityLinkRequest(body);
    const identity = await this.verifier.verifyApple(
      parsed.identityToken,
      parsed.rawNonce,
    );
    return this.auth.linkIdentity(
      request.authenticatedUserId,
      identity,
      request.requestId,
    );
  }

  @Post("google")
  async linkGoogle(
    @Req() request: PrivateAuthRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    sessionId(request);
    await this.rateLimiter.consume(
      "auth:link",
      request.authenticatedUserId,
      10,
    );
    const parsed = parseGoogleIdentityLinkRequest(body);
    const identity = await this.verifier.verifyGoogle(parsed.idToken);
    return this.auth.linkIdentity(
      request.authenticatedUserId,
      identity,
      request.requestId,
    );
  }

  @Delete(":provider")
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlink(
    @Req() request: PrivateAuthRequest,
    @Param("provider") provider: string,
  ): Promise<void> {
    sessionId(request);
    await this.rateLimiter.consume(
      "auth:unlink",
      request.authenticatedUserId,
      10,
    );
    await this.auth.unlinkIdentity(
      request.authenticatedUserId,
      parseProvider(provider),
      request.requestId,
    );
  }
}
