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
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            environment: "local",
            apiBasePath: "/api",
            googleClientId: "",
            appVersion: "local-dev",
          }),
          { status: 200 },
        ),
      ),
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
