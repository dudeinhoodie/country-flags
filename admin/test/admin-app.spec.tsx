import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminApp } from "../src/app/AdminApp";
import type { RuntimeConfig } from "../src/config/runtime-config";

const devConfig: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
};

describe("AdminApp", () => {
  it("renders the dashboard shell with a dev badge", async () => {
    render(<AdminApp config={devConfig} />);
    expect(
      await screen.findByText("Catalog administration"),
    ).toBeInTheDocument();
    expect(screen.getByText("DEV")).toBeInTheDocument();
  });

  it("marks prod so it cannot be mistaken for dev", async () => {
    render(<AdminApp config={{ ...devConfig, environment: "prod" }} />);
    expect(await screen.findByText("PROD")).toBeInTheDocument();
    expect(screen.queryByText("DEV")).not.toBeInTheDocument();
  });
});
