import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminApiClient } from "../src/api/client";
import { createAuthProvider } from "../src/app/auth-provider";

const viewer = {
  id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
  email: "editor@example.test",
  displayName: "editor",
  role: "VIEWER",
  status: "ACTIVE",
  createdAt: "2026-08-23T10:00:00Z",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildProvider(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return createAuthProvider(createAdminApiClient("/api"));
}

describe("createAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates through /v1/admin/me and caches the identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(viewer, 200));
    const provider = buildProvider(fetchMock);

    await expect(provider.checkAuth({})).resolves.toBeUndefined();
    await expect(provider.getPermissions?.({})).resolves.toBe("VIEWER");
    const identity = await provider.getIdentity?.();
    expect(identity?.fullName).toBe("editor");
    // One request served all three calls: the identity is cached in memory.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects checkAuth when the session is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Admin authentication is required",
          },
        },
        401,
      ),
    );
    const provider = buildProvider(fetchMock);
    await expect(provider.checkAuth({})).rejects.toMatchObject({
      status: 401,
    });
  });

  it("logs out through the API and never throws", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const provider = buildProvider(fetchMock);
    await expect(provider.logout({})).resolves.toBeUndefined();
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(request.url).toContain("/v1/admin/auth/logout");
    expect(request.method).toBe("POST");
  });

  it("treats 401 as a session loss and keeps other errors", async () => {
    const provider = buildProvider(vi.fn());
    await expect(provider.checkError({ status: 401 })).rejects.toBeInstanceOf(
      Error,
    );
    await expect(provider.checkError({ status: 500 })).resolves.toBeUndefined();
  });
});
