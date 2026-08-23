import createClient from "openapi-fetch";
import type { paths } from "./generated/admin-api";

/**
 * The admin API is reached same-origin through the console's `/api` reverse
 * proxy, so the base URL is the runtime config's `apiBasePath` and the
 * session cookie travels automatically.
 */
export function createAdminApiClient(apiBasePath: string) {
  // A relative base path ("/api") must become absolute: the fetch Request
  // constructor outside a document context rejects relative URLs.
  const baseUrl = new URL(apiBasePath, window.location.origin)
    .toString()
    .replace(/\/+$/, "");
  return createClient<paths>({
    baseUrl,
    credentials: "include",
  });
}

export type AdminApiClient = ReturnType<typeof createAdminApiClient>;
