import { type ExecutionContext, HttpStatus } from "@nestjs/common";
import { UserStatus } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type {
  AccessTokenClaims,
  AccessTokenService,
} from "../auth/access-token.service";
import type { AuthGuard, AuthenticatedRequest } from "../auth/auth.guard";
import { AccountDeletionGuard } from "./account-deletion.guard";

const USER_ID = "80000000-0000-4000-8000-000000000001";
const SESSION_ID = "80000000-0000-4000-8000-0000000000aa";
const DELETED_AT = new Date("2026-09-28T10:00:00.000Z");

function contextFor(authorization: string | undefined): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = {
    header: ((name: string) =>
      name === "authorization"
        ? authorization
        : undefined) as AuthenticatedRequest["header"],
  };
  return {
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
    request,
  };
}

function unauthorized(): ApiException {
  return new ApiException(
    HttpStatus.UNAUTHORIZED,
    "UNAUTHORIZED",
    "Authentication is required",
  );
}

/** An `AuthGuard` that lets the request in, or refuses it with `error`. */
function authGuard(error: Error | null = null): AuthGuard {
  return {
    canActivate: (context: ExecutionContext) => {
      if (error !== null) {
        return Promise.reject(error);
      }
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      request.authenticatedUserId = USER_ID;
      request.authenticatedSessionId = SESSION_ID;
      return Promise.resolve(true);
    },
  } as unknown as AuthGuard;
}

function accessTokens(claims: AccessTokenClaims | null): AccessTokenService {
  return {
    verify: () =>
      claims === null
        ? Promise.reject(new Error("invalid token"))
        : Promise.resolve(claims),
  } as unknown as AccessTokenService;
}

function database(
  user: { status: UserStatus; deletedAt: Date | null } | null,
): PrismaService {
  return {
    user: { findUnique: () => Promise.resolve(user) },
  } as unknown as PrismaService;
}

const claims: AccessTokenClaims = {
  subject: USER_ID,
  sessionId: SESSION_ID,
  tokenId: "80000000-0000-4000-8000-0000000000bb",
  issuedAt: new Date(DELETED_AT.getTime() - 60_000),
  expiresAt: new Date(DELETED_AT.getTime() + 840_000),
};

async function refusal(promise: Promise<boolean>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe("AccountDeletionGuard", () => {
  it("lets a live session through exactly as AuthGuard does", async () => {
    const { context, request } = contextFor("Bearer live-token");
    const guard = new AccountDeletionGuard(
      authGuard(),
      accessTokens(null),
      database(null),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authenticatedUserId).toBe(USER_ID);
  });

  it("lets a repeated deletion reach the service once the account is deleted", async () => {
    // The first request deleted the account and its sessions, and its
    // response never arrived. The repeat carries the same token.
    const { context, request } = contextFor("Bearer same-token");
    const guard = new AccountDeletionGuard(
      authGuard(unauthorized()),
      accessTokens(claims),
      database({ status: UserStatus.DELETED, deletedAt: DELETED_AT }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authenticatedUserId).toBe(USER_ID);
    expect(request.authenticatedSessionId).toBe(SESSION_ID);
    expect(request.testOnlyAuthentication).toBe(false);
  });

  it("refuses a revoked session of an account that still exists", async () => {
    // A signed-out token must never be able to delete the account.
    const refused = unauthorized();
    const guard = new AccountDeletionGuard(
      authGuard(refused),
      accessTokens(claims),
      database({ status: UserStatus.ACTIVE, deletedAt: null }),
    );

    await expect(
      refusal(guard.canActivate(contextFor("Bearer revoked-token").context)),
    ).resolves.toBe(refused);
  });

  it("refuses a token that does not verify", async () => {
    const refused = unauthorized();
    const guard = new AccountDeletionGuard(
      authGuard(refused),
      accessTokens(null),
      database({ status: UserStatus.DELETED, deletedAt: DELETED_AT }),
    );

    await expect(
      refusal(guard.canActivate(contextFor("Bearer forged-token").context)),
    ).resolves.toBe(refused);
  });

  it("refuses a request without a bearer", async () => {
    const refused = unauthorized();
    const guard = new AccountDeletionGuard(
      authGuard(refused),
      accessTokens(claims),
      database({ status: UserStatus.DELETED, deletedAt: DELETED_AT }),
    );

    await expect(
      refusal(guard.canActivate(contextFor(undefined).context)),
    ).resolves.toBe(refused);
  });

  it("refuses a token issued after the deletion", async () => {
    const refused = unauthorized();
    const guard = new AccountDeletionGuard(
      authGuard(refused),
      accessTokens({
        ...claims,
        issuedAt: new Date(DELETED_AT.getTime() + 1_000),
      }),
      database({ status: UserStatus.DELETED, deletedAt: DELETED_AT }),
    );

    await expect(
      refusal(guard.canActivate(contextFor("Bearer later-token").context)),
    ).resolves.toBe(refused);
  });

  it("passes on refusals that are not about authentication", async () => {
    const limited = new ApiException(
      HttpStatus.TOO_MANY_REQUESTS,
      "RATE_LIMITED",
      "Too many requests",
    );
    const guard = new AccountDeletionGuard(
      authGuard(limited),
      accessTokens(claims),
      database({ status: UserStatus.DELETED, deletedAt: DELETED_AT }),
    );

    await expect(
      refusal(guard.canActivate(contextFor("Bearer same-token").context)),
    ).resolves.toBe(limited);
  });
});
