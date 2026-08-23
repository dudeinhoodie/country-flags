import type { AuthProvider } from "react-admin";
import type { AdminApiClient } from "../api/client";
import { toHttpError } from "../api/errors";
import type { components } from "../api/generated/admin-api";

type AdminUser = components["schemas"]["AdminUser"];

/**
 * Sessions live in an HttpOnly cookie the code cannot (and must not) read;
 * the only authentication signal is whether /v1/admin/me answers. The
 * current user is cached in memory — never in localStorage.
 */
export function createAuthProvider(client: AdminApiClient): AuthProvider {
  let currentUser: AdminUser | null = null;

  async function fetchMe(): Promise<AdminUser> {
    const { data, response, error } = await client.GET("/v1/admin/me");
    if (data === undefined) {
      currentUser = null;
      throw toHttpError(response.status, error);
    }
    currentUser = data;
    return data;
  }

  return {
    login() {
      return Promise.reject(
        new Error(
          "Sign-in happens through the Google button on the login page",
        ),
      );
    },
    async logout() {
      currentUser = null;
      try {
        await client.POST("/v1/admin/auth/logout");
      } catch {
        // The session may already be gone; logging out stays a success.
      }
    },
    async checkAuth() {
      await fetchMe();
    },
    checkError(error: unknown) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 401) {
        currentUser = null;
        return Promise.reject(
          error instanceof Error
            ? error
            : new Error("The admin session has expired"),
        );
      }
      return Promise.resolve();
    },
    async getIdentity() {
      const user = currentUser ?? (await fetchMe());
      return { id: user.id, fullName: user.displayName };
    },
    async getPermissions() {
      const user = currentUser ?? (await fetchMe());
      return user.role;
    },
  };
}
