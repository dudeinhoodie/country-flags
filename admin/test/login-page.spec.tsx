import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { LoginPage } from "../src/app/LoginPage";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import type { RuntimeConfig } from "../src/config/runtime-config";

const config: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
  features: {},
};

describe("LoginPage", () => {
  it("explains when Google sign-in is not configured", () => {
    render(
      <RuntimeConfigProvider config={config}>
        <ApiClientProvider client={createAdminApiClient("/api")}>
          <LoginPage />
        </ApiClientProvider>
      </RuntimeConfigProvider>,
    );
    expect(
      screen.getByText(/Google sign-in is not configured/),
    ).toBeInTheDocument();
    expect(screen.getByText("DEV")).toBeInTheDocument();
  });
});
