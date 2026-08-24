import { defineConfig, devices } from "@playwright/test";

/**
 * The console is served by its own dev server with the committed mock
 * runtime config; the API is stubbed per test. Nothing here reaches a
 * backend, a database or a network, so a failure names a console problem
 * rather than an environment one.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? "list" : "github",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The built bundle rather than the dev server: what CI checks is what
    // the image would serve.
    command: "yarn preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/config.json",
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
