import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApp } from "../src/app/AdminApp";
import type { RuntimeConfig } from "../src/config/runtime-config";

const devConfig: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
};

const viewer = {
  id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
  email: "editor@example.test",
  displayName: "editor",
  role: "VIEWER",
  status: "ACTIVE",
  createdAt: "2026-08-23T10:00:00Z",
};

function stubAdminApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: Request | URL | string) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/v1/admin/me")) {
        return Promise.resolve(
          new Response(JSON.stringify(viewer), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.includes("/v1/admin/content/status")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              activeVersion: "2026.08.20",
              minimumClientVersion: "0.1.0",
              schemaVersion: 1,
              publishedAt: "2026-08-20T10:00:00Z",
              entityCount: 278,
              deckCount: 6,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "RESOURCE_NOT_FOUND",
              message: "not found",
              requestId: viewer.id,
              details: {},
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      );
    }),
  );
}

describe("AdminApp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("renders the dashboard shell with a dev badge once authenticated", async () => {
    stubAdminApi();
    render(<AdminApp config={devConfig} />);
    expect(
      await screen.findByText("Catalog administration"),
    ).toBeInTheDocument();
    expect(screen.getByText("DEV")).toBeInTheDocument();
    expect(await screen.findByText("2026.08.20")).toBeInTheDocument();
  });

  it("marks prod so it cannot be mistaken for dev", async () => {
    stubAdminApi();
    render(<AdminApp config={{ ...devConfig, environment: "prod" }} />);
    expect(await screen.findByText("PROD")).toBeInTheDocument();
    expect(screen.queryByText("DEV")).not.toBeInTheDocument();
  });
});
