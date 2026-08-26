import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Bootstrap } from "../src/app/Bootstrap";

describe("Bootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the app once the runtime config loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: Request | URL | string) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.includes("/v1/admin/me")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: "8f1f9f76-1f0a-4a2e-9a5e-2b8f4f1c9d10",
                email: "editor@example.test",
                displayName: "editor",
                role: "VIEWER",
                status: "ACTIVE",
                createdAt: "2026-08-23T10:00:00Z",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        if (url.includes("/v1/admin/content/status")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                activeVersion: null,
                minimumClientVersion: null,
                schemaVersion: null,
                publishedAt: null,
                entityCount: 0,
                deckCount: 0,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              environment: "local",
              apiBasePath: "/api",
              googleClientId: "",
              appVersion: "local-dev",
            }),
            { status: 200 },
          ),
        );
      }),
    );
    render(<Bootstrap />);
    expect(
      await screen.findByText("Catalog administration"),
    ).toBeInTheDocument();
  });

  it("blocks startup when the config is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404 })),
    );
    render(<Bootstrap />);
    expect(
      await screen.findByText("The admin console cannot start"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 404");
  });

  it("blocks startup and lists problems when the config is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ environment: "staging", apiBasePath: "/api" }),
            { status: 200 },
          ),
        ),
    );
    render(<Bootstrap />);
    expect(
      await screen.findByText("The admin console cannot start"),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      '"environment" must be one of: local, dev, prod',
    );
  });
});
