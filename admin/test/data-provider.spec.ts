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

  it("maps the entities resource with search onto the content API", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ items: [], total: 0 })),
      );
    const provider = buildProvider(fetchMock);
    await provider.getList("entities", {
      ...listParams,
      filter: { q: "france" },
    });
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/v1/admin/content/entities");
    expect(request.url).toContain("q=france");
    expect(request.url).toContain("offset=10");

    await provider.getOne("entities", { id: viewer.id });
    const detailRequest = fetchMock.mock.calls[1]?.[0] as Request;
    expect(detailRequest.url).toContain(
      `/v1/admin/content/entities/${viewer.id}`,
    );
  });

  it("maps the decks resource onto the content API", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], total: 0 }));
    const provider = buildProvider(fetchMock);
    await provider.getList("decks", listParams);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/v1/admin/content/decks");
    expect(request.url).toContain("limit=10");
  });

  it("maps the drafts resource onto the drafts API", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ items: [], total: 0 })),
      );
    const provider = buildProvider(fetchMock);
    await provider.getList("drafts", listParams);
    const listRequest = fetchMock.mock.calls[0]?.[0] as Request;
    expect(listRequest.url).toContain("/v1/admin/content/drafts");

    await provider.create("drafts", { data: {} });
    const createRequest = fetchMock.mock.calls[1]?.[0] as Request;
    expect(createRequest.method).toBe("POST");
    expect(createRequest.url).toContain("/v1/admin/content/drafts");
  });

  it("fails loudly for resources without endpoints", async () => {
    const provider = buildProvider(vi.fn());
    await expect(provider.getList("assets", listParams)).rejects.toThrow(
      'Resource "assets" does not support getList',
    );
  });
});
