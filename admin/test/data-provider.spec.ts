import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminApiClient } from "../src/api/client";
import { createAdminDataProvider } from "../src/app/data-provider";

const viewer = {
  id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
  email: "editor@example.test",
  displayName: "editor",
  role: "VIEWER",
  status: "ACTIVE",
  createdAt: "2026-08-23T10:00:00Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildProvider(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return createAdminDataProvider(createAdminApiClient("/api"));
}

const listParams = {
  pagination: { page: 2, perPage: 10 },
  sort: { field: "email", order: "ASC" as const },
  filter: {},
};

describe("createAdminDataProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps react-admin pagination onto offset/limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [viewer], total: 11 }));
    const provider = buildProvider(fetchMock);

    const result = (await provider.getList("users", listParams)) as unknown as {
      data: { id: string }[];
      total: number;
    };
    expect(result.total).toBe(11);
    expect(result.data[0]?.id).toBe(viewer.id);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/v1/admin/users");
    expect(request.url).toContain("offset=10");
    expect(request.url).toContain("limit=10");
  });

  it("fetches a single admin user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(viewer));
    const provider = buildProvider(fetchMock);
    const result = (await provider.getOne("users", {
      id: viewer.id,
    })) as unknown as {
      data: { email: string };
    };
    expect(result.data.email).toBe(viewer.email);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain(`/v1/admin/users/${viewer.id}`);
  });

  it("sends only role and status in an update", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...viewer, role: "EDITOR" }));
    const provider = buildProvider(fetchMock);
    const result = (await provider.update("users", {
      id: viewer.id,
      data: { ...viewer, role: "EDITOR" },
      previousData: viewer,
    })) as unknown as { data: { role: string } };
    expect(result.data.role).toBe("EDITOR");
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe("PATCH");
    await expect(request.json()).resolves.toEqual({
      role: "EDITOR",
      status: "ACTIVE",
    });
  });

  it("surfaces the server's error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "ADMIN_SELF_CHANGE_FORBIDDEN",
            message: "An administrator cannot change their own role or status",
          },
        },
        403,
      ),
    );
    const provider = buildProvider(fetchMock);
    await expect(
      provider.update("users", {
        id: viewer.id,
        data: { role: "VIEWER" },
        previousData: viewer,
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: "An administrator cannot change their own role or status",
    });
  });

  it("fails loudly for resources without endpoints", async () => {
    const provider = buildProvider(vi.fn());
    await expect(provider.getList("decks", listParams)).rejects.toThrow(
      'Resource "decks" does not support getList',
    );
  });
});
