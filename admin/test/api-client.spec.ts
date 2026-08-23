import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminApiClient } from "../src/api/client";

describe("createAdminApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins apiBasePath with contract paths and sends the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
          email: "editor@example.com",
          displayName: "Content Editor",
          role: "VIEWER",
          status: "ACTIVE",
          createdAt: "2026-08-23T10:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createAdminApiClient("https://admin.example.test/api");
    const { data, response } = await client.GET("/v1/admin/me");

    expect(response.status).toBe(200);
    expect(data?.role).toBe("VIEWER");
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://admin.example.test/api/v1/admin/me");
    expect(request.credentials).toBe("include");
  });
});
