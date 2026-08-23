import createClient from "openapi-fetch";
import type { paths } from "./generated/admin-api";

/**
 * The admin API is reached same-origin through the console's `/api` reverse
 * proxy, so the base URL is the runtime config's `apiBasePath` and the
 * session cookie travels automatically.
 */
export function createAdminApiClient(apiBasePath: string) {
  return createClient<paths>({
    baseUrl: apiBasePath,
    credentials: "include",
  });
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
