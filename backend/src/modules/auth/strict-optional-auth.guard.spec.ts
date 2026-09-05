import { type ExecutionContext, HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";
import type { AuthenticatedRequest } from "./auth.guard";
import type { OptionalAuthGuard } from "./optional-auth.guard";
import { StrictOptionalAuthGuard } from "./strict-optional-auth.guard";

const USER_ID = "80000000-0000-4000-8000-000000000001";

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

function guardThatAuthenticates(userId: string | null): OptionalAuthGuard {
  return {
    canActivate: (context: ExecutionContext) => {
      if (userId !== null) {
        const request = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        request.authenticatedUserId = userId;
      }
      return Promise.resolve(true);
    },
  } as unknown as OptionalAuthGuard;
}

describe("StrictOptionalAuthGuard", () => {
  it("lets a request with no credentials through as a guest", async () => {
    const { context, request } = contextFor(undefined);
    const guard = new StrictOptionalAuthGuard(guardThatAuthenticates(null));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authenticatedUserId).toBeUndefined();
  });

  it("carries an identity the bearer proved", async () => {
    const { context, request } = contextFor("Bearer good-token");
    const guard = new StrictOptionalAuthGuard(guardThatAuthenticates(USER_ID));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.authenticatedUserId).toBe(USER_ID);
  });

  it("refuses a bearer it could not verify instead of demoting it", async () => {
    // An expired token must read as "refresh me", not as "you are a guest";
    // demoted to anonymous it would come back as a paywall for a deck the
    // account owns.
    const { context } = contextFor("Bearer expired-token");
    const guard = new StrictOptionalAuthGuard(guardThatAuthenticates(null));

    const thrown = await guard
      .canActivate(context)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(ApiException);
    expect((thrown as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((thrown as ApiException).getResponse()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("refuses credentials that are not a bearer at all", async () => {
    const { context } = contextFor("Basic dXNlcjpwYXNz");
    const guard = new StrictOptionalAuthGuard(guardThatAuthenticates(null));

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ApiException,
    );
  });
});
