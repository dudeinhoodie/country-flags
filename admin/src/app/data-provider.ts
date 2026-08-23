import type { DataProvider } from "react-admin";
import type { AdminApiClient } from "../api/client";
import { toHttpError } from "../api/errors";
import type { components } from "../api/generated/admin-api";

type AdminUser = components["schemas"]["AdminUser"];
type AdminRole = components["schemas"]["AdminRole"];
type AdminUserStatus = components["schemas"]["AdminUserStatus"];

function unsupported(resource: string, method: string): Error {
  return new Error(
    `Resource "${resource}" does not support ${method} yet; it arrives with its own screen.`,
  );
}

/**
 * Maps react-admin's DataProvider onto the admin API. Only the resources
 * that already have server endpoints are wired; everything else fails
 * loudly instead of pretending.
 */
export function createAdminDataProvider(client: AdminApiClient): DataProvider {
  const provider = {
    async getList(
      resource: string,
      params: {
        pagination?: { page: number; perPage: number };
        filter?: Record<string, unknown>;
      },
    ) {
      const page = params.pagination?.page ?? 1;
      const perPage = Math.min(params.pagination?.perPage ?? 25, 100);
      const pagination = { offset: (page - 1) * perPage, limit: perPage };
      if (resource === "users") {
        const { data, response, error } = await client.GET("/v1/admin/users", {
          params: { query: pagination },
        });
        if (data === undefined) {
          throw toHttpError(response.status, error);
        }
        return { data: data.items, total: data.total };
      }
      if (resource === "entities") {
        const search = params.filter?.q;
        const { data, response, error } = await client.GET(
          "/v1/admin/content/entities",
          {
            params: {
              query: {
                ...pagination,
                ...(typeof search === "string" && search.length > 0
                  ? { q: search }
                  : {}),
              },
            },
          },
        );
        if (data === undefined) {
          throw toHttpError(response.status, error);
        }
        return { data: data.items, total: data.total };
      }
      if (resource === "decks") {
        const { data, response, error } = await client.GET(
          "/v1/admin/content/decks",
          { params: { query: pagination } },
        );
        if (data === undefined) {
          throw toHttpError(response.status, error);
        }
        return { data: data.items, total: data.total };
      }
      throw unsupported(resource, "getList");
    },
    async getOne(resource: string, params: { id: string | number }) {
      const id = String(params.id);
      if (resource === "users") {
        const { data, response, error } = await client.GET(
          "/v1/admin/users/{adminUserId}",
          { params: { path: { adminUserId: id } } },
        );
        if (data === undefined) {
          throw toHttpError(response.status, error);
        }
        return { data };
      }
      if (resource === "entities") {
        const { data, response, error } = await client.GET(
          "/v1/admin/content/entities/{entityId}",
          { params: { path: { entityId: id } } },
        );
        if (data === undefined) {
          throw toHttpError(response.status, error);
        }
        return { data };
      }
      if (resource === "decks") {
        const { data, response, error } = await client.GET(
          "/v1/admin/content/decks/{deckId}",
          { params: { path: { deckId: id } } },
        );
        if (data === undefined) {
          throw toHttpError(response.status, error);
        }
        return { data };
      }
      throw unsupported(resource, "getOne");
    },
    async update(
      resource: string,
      params: { id: string | number; data: Partial<AdminUser> },
    ) {
      if (resource !== "users") {
        throw unsupported(resource, "update");
      }
      const body: { role?: AdminRole; status?: AdminUserStatus } = {};
      if (params.data.role !== undefined) {
        body.role = params.data.role;
      }
      if (params.data.status !== undefined) {
        body.status = params.data.status;
      }
      const { data, response, error } = await client.PATCH(
        "/v1/admin/users/{adminUserId}",
        { params: { path: { adminUserId: String(params.id) } }, body },
      );
      if (data === undefined) {
        throw toHttpError(response.status, error);
      }
      return { data };
    },
    getMany(resource: string) {
      return Promise.reject(unsupported(resource, "getMany"));
    },
    getManyReference(resource: string) {
      return Promise.reject(unsupported(resource, "getManyReference"));
    },
    create(resource: string) {
      return Promise.reject(unsupported(resource, "create"));
    },
    updateMany(resource: string) {
      return Promise.reject(unsupported(resource, "updateMany"));
    },
    delete(resource: string) {
      return Promise.reject(unsupported(resource, "delete"));
    },
    deleteMany(resource: string) {
      return Promise.reject(unsupported(resource, "deleteMany"));
    },
  };
  return provider as unknown as DataProvider;
}
