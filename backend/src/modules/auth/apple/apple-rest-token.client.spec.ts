import { generateKeyPairSync } from "node:crypto";

import { ConfigService } from "@nestjs/config";

import type { EnvironmentVariables } from "../../../config/environment.validation";
import { AppleRestTokenClient } from "./apple-rest-token.client";

interface Call {
  url: string;
  form: URLSearchParams;
}

function respond(status: number, body: unknown): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AppleRestTokenClient", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const configured = {
    AUTH_APPLE_TEAM_ID: "TESTTEAM01",
    AUTH_APPLE_KEY_ID: "TESTKEY001",
    AUTH_APPLE_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  };
  const clientId = "app.countryflags.mobile";

  function client(
    answers: Array<Response | Error>,
    config: Record<string, string> = configured,
  ): { client: AppleRestTokenClient; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({
        url,
        form: new URLSearchParams(init?.body as URLSearchParams),
      });
      const answer = answers.shift();
      if (answer === undefined) {
        return Promise.reject(new Error("Unexpected request"));
      }
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    }) as typeof fetch;
    return {
      client: new AppleRestTokenClient(
        new ConfigService<EnvironmentVariables>(config),
        fetchImpl,
      ),
      calls,
    };
  }

  it("exchanges an authorization code with a client secret signed by the Sign in with Apple key", async () => {
    const { client: apple, calls } = client([
      respond(200, {
        access_token: "TEST_ONLY_access",
        refresh_token: "TEST_ONLY_refresh",
        id_token: "TEST_ONLY_id",
      }),
    ]);

    await expect(
      apple.exchangeAuthorizationCode({
        clientId,
        authorizationCode: "TEST_ONLY_code",
      }),
    ).resolves.toEqual({
      kind: "exchanged",
      refreshToken: "TEST_ONLY_refresh",
    });

    const [call] = calls;
    expect(call?.url).toBe("https://appleid.apple.com/auth/token");
    expect(call?.form.get("grant_type")).toBe("authorization_code");
    expect(call?.form.get("code")).toBe("TEST_ONLY_code");
    expect(call?.form.get("client_id")).toBe(clientId);

    const { jwtVerify, decodeProtectedHeader } = await import("jose");
    const secret = call?.form.get("client_secret") ?? "";
    expect(decodeProtectedHeader(secret)).toMatchObject({
      alg: "ES256",
      kid: "TESTKEY001",
    });
    const { payload } = await jwtVerify(secret, publicKey, {
      issuer: "TESTTEAM01",
      audience: "https://appleid.apple.com",
      subject: clientId,
    });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(3_600);
  });

  it("revokes a refresh token and reuses the client secret while it is fresh", async () => {
    const { client: apple, calls } = client([
      respond(200, undefined),
      respond(200, undefined),
    ]);

    await expect(
      apple.revokeRefreshToken({ clientId, refreshToken: "TEST_ONLY_refresh" }),
    ).resolves.toEqual({ kind: "revoked" });
    await apple.revokeRefreshToken({ clientId, refreshToken: "second" });

    expect(calls[0]?.url).toBe("https://appleid.apple.com/auth/revoke");
    expect(calls[0]?.form.get("token")).toBe("TEST_ONLY_refresh");
    expect(calls[0]?.form.get("token_type_hint")).toBe("refresh_token");
    expect(calls[1]?.form.get("client_secret")).toBe(
      calls[0]?.form.get("client_secret"),
    );
  });

  it("answers Apple's refusals, outages and odd answers instead of throwing", async () => {
    const { client: apple } = client([
      respond(400, { error: "invalid_grant" }),
      respond(503, { error: "server_error" }),
      new TypeError("fetch failed"),
      respond(200, { access_token: "no refresh token" }),
      respond(400, { error: "something_new" }),
      respond(400, { error: "invalid_client" }),
    ]);
    const exchange = (): ReturnType<typeof apple.exchangeAuthorizationCode> =>
      apple.exchangeAuthorizationCode({
        clientId,
        authorizationCode: "TEST_ONLY_code",
      });

    await expect(exchange()).resolves.toEqual({
      kind: "failed",
      reason: "invalid_grant",
    });
    await expect(exchange()).resolves.toEqual({
      kind: "failed",
      reason: "unavailable",
    });
    await expect(exchange()).resolves.toEqual({
      kind: "failed",
      reason: "unavailable",
    });
    await expect(exchange()).resolves.toEqual({
      kind: "failed",
      reason: "malformed_response",
    });
    await expect(exchange()).resolves.toEqual({
      kind: "failed",
      reason: "rejected",
    });
    await expect(
      apple.revokeRefreshToken({ clientId, refreshToken: "TEST_ONLY_refresh" }),
    ).resolves.toEqual({ kind: "failed", reason: "invalid_client" });
  });

  it("says it is not configured, and asks Apple nothing, without the key", async () => {
    const { client: apple, calls } = client([], {});

    expect(apple.configured).toBe(false);
    await expect(
      apple.exchangeAuthorizationCode({
        clientId,
        authorizationCode: "TEST_ONLY_code",
      }),
    ).resolves.toEqual({ kind: "not_configured" });
    await expect(
      apple.revokeRefreshToken({ clientId, refreshToken: "TEST_ONLY_refresh" }),
    ).resolves.toEqual({ kind: "not_configured" });
    expect(calls).toHaveLength(0);
  });
});
