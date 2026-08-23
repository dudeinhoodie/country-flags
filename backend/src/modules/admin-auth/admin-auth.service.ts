import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminUserStatus, AuthProvider } from "@prisma/client";
import type { AdminUser } from "@prisma/client";

import { ApiException } from "../../common/http/api.exception";
import type { EnvironmentVariables } from "../../config/environment.validation";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { ProviderIdentityVerifier } from "../auth/provider-identity-verifier";
import { isEmailAllowlisted, normalizeAdminEmail } from "./admin-allowlist";
import { AdminSessionService } from "./admin-session.service";
import type { AdminSessionContext } from "./admin-session.service";

export interface AdminLoginResult {
  user: AdminUser;
  token: string;
  absoluteTtlSeconds: number;
}

/**
 * One 403 for every refusal (unlisted, disabled, unverified email): the
 * response must not reveal whether an address is on the allowlist.
 */
function adminAccessDenied(): never {
  throw new ApiException(
    HttpStatus.FORBIDDEN,
    "ADMIN_ACCESS_DENIED",
    "This account has no admin access",
  );
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables>,
    private readonly verifier: ProviderIdentityVerifier,
    private readonly sessions: AdminSessionService,
  ) {}

  async loginWithGoogle(
    idToken: string,
    context: AdminSessionContext,
  ): Promise<AdminLoginResult> {
    const identity = await this.verifier.verifyGoogle(
      idToken,
      this.config.getOrThrow<string[]>("ADMIN_GOOGLE_CLIENT_IDS"),
    );
    if (identity.email === null || identity.emailVerified !== true) {
      adminAccessDenied();
    }
    const email = normalizeAdminEmail(identity.email);

    const user = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.adminIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: AuthProvider.GOOGLE,
            providerSubject: identity.subject,
          },
        },
        include: { adminUser: true },
      });
      if (existing !== null) {
        await transaction.adminIdentity.update({
          where: { id: existing.id },
          data: {
            lastLoginAt: new Date(),
            email: identity.email,
            emailVerified: identity.emailVerified,
          },
          select: { id: true },
        });
        return existing.adminUser;
      }

      if (
        !isEmailAllowlisted(
          email,
          this.config.getOrThrow<string[]>("ADMIN_EMAIL_ALLOWLIST"),
        )
      ) {
        adminAccessDenied();
      }
      // A different Google subject with an already-registered email is not
      // merged automatically (same rule as consumer identities): an ADMIN
      // resolves it by hand once access management lands.
      const emailTaken = await transaction.adminUser.findUnique({
        where: { email },
        select: { id: true },
      });
      if (emailTaken !== null) {
        adminAccessDenied();
      }
      return transaction.adminUser.create({
        data: {
          email,
          displayName: email.slice(0, email.lastIndexOf("@")),
          identities: {
            create: {
              provider: AuthProvider.GOOGLE,
              providerSubject: identity.subject,
              email: identity.email,
              emailVerified: identity.emailVerified,
            },
          },
        },
      });
    });

    if (user.status !== AdminUserStatus.ACTIVE) {
      adminAccessDenied();
    }

    const session = await this.sessions.issue(user.id, context);
    return { user, ...session };
  }
}
