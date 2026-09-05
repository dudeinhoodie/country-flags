import { StoreEnvironment } from "@prisma/client";

import type { DeploymentEnvironment } from "../../config/deployment-environment";

/**
 * Which store this deployment talks to (17-paid-decks-storekit §14).
 *
 * Derived from the deployment rather than configured beside it. A store
 * environment that could be set independently could be set wrong, and the
 * failure is not a broken screen: a Sandbox transaction accepted by
 * production opens a paid deck for free, and a Sandbox product mapped while
 * looking at production is sold to nobody. Deriving it makes both
 * impossible to configure.
 *
 * `local` and `ci` get `LOCAL_TEST` because their purchases come from
 * Xcode's StoreKit configuration, which no real verifier accepts.
 */
export function storeEnvironmentFor(
  deployment: DeploymentEnvironment,
): StoreEnvironment {
  switch (deployment) {
    case "prod":
      return StoreEnvironment.PRODUCTION;
    case "dev":
      return StoreEnvironment.SANDBOX;
    default:
      return StoreEnvironment.LOCAL_TEST;
  }
}
