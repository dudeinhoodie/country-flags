import { createHmac, timingSafeEqual } from "node:crypto";

import { Injectable } from "@nestjs/common";

const TEST_JWT_ISSUER = "country-flags-test";
const TEST_JWT_AUDIENCE = "country-flags-api";
const TEST_SIGNING_KEY =
  "TEST_ONLY_country_flags_local_signing_key_v1_never_for_production";

interface TestJwtHeader {
  alg: "HS256";
  typ: "JWT";
}

export interface TestJwtClaims {
  sub: string;
  iss: typeof TEST_JWT_ISSUER;
  aud: typeof TEST_JWT_AUDIENCE;
  iat: number;
  exp: number;
  testOnly: true;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(value: string): Buffer {
  return createHmac("sha256", TEST_SIGNING_KEY).update(value).digest();
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error("Malformed test JWT");
  }
}

@Injectable()
export class TestJwtSigner {
  sign(
    userId: string,
    options: {
      issuedAt?: Date;
      expiresAt?: Date;
    } = {},
  ): string {
    const issuedAt = options.issuedAt ?? new Date();
    const expiresAt =
      options.expiresAt ?? new Date(issuedAt.getTime() + 24 * 60 * 60 * 1_000);
    const header: TestJwtHeader = { alg: "HS256", typ: "JWT" };
    const claims: TestJwtClaims = {
      sub: userId,
      iss: TEST_JWT_ISSUER,
      aud: TEST_JWT_AUDIENCE,
      iat: Math.floor(issuedAt.getTime() / 1_000),
      exp: Math.floor(expiresAt.getTime() / 1_000),
      testOnly: true,
    };
    const unsigned = `${encode(header)}.${encode(claims)}`;

    return `${unsigned}.${signature(unsigned).toString("base64url")}`;
  }

  verify(token: string, now = new Date()): TestJwtClaims {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Malformed test JWT");
    }
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    if (
      encodedHeader === undefined ||
      encodedClaims === undefined ||
      encodedSignature === undefined
    ) {
      throw new Error("Malformed test JWT");
    }

    const expectedSignature = signature(`${encodedHeader}.${encodedClaims}`);
    const receivedSignature = Buffer.from(encodedSignature, "base64url");
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      throw new Error("Invalid test JWT signature");
    }

    const header = parseJson(encodedHeader);
    const claims = parseJson(encodedClaims);
    if (
      typeof header !== "object" ||
      header === null ||
      !("alg" in header) ||
      header.alg !== "HS256" ||
      !("typ" in header) ||
      header.typ !== "JWT"
    ) {
      throw new Error("Invalid test JWT header");
    }
    if (
      typeof claims !== "object" ||
      claims === null ||
      !("sub" in claims) ||
      typeof claims.sub !== "string" ||
      !("iss" in claims) ||
      claims.iss !== TEST_JWT_ISSUER ||
      !("aud" in claims) ||
      claims.aud !== TEST_JWT_AUDIENCE ||
      !("iat" in claims) ||
      typeof claims.iat !== "number" ||
      !("exp" in claims) ||
      typeof claims.exp !== "number" ||
      !("testOnly" in claims) ||
      claims.testOnly !== true
    ) {
      throw new Error("Invalid test JWT claims");
    }

    const nowSeconds = Math.floor(now.getTime() / 1_000);
    if (claims.iat > nowSeconds || claims.exp <= nowSeconds) {
      throw new Error("Expired or not-yet-valid test JWT");
    }

    return claims as TestJwtClaims;
  }
}
