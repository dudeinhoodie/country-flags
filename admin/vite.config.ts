import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Local development against a real backend needs a real Google client id
// in the runtime config, but public/config.json is the committed mock.
// When these variables are set, the dev server serves /config.json from
// them instead; nothing is written to disk and nothing reaches the bundle.
function runtimeConfigOverride(): Plugin | false {
  const googleClientId = process.env.ADMIN_DEV_GOOGLE_CLIENT_ID;
  const environment = process.env.ADMIN_DEV_ENVIRONMENT;
  if (googleClientId === undefined && environment === undefined) {
    return false;
  }
  return {
    name: "admin-runtime-config-override",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/config.json") {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(
          JSON.stringify({
            environment: environment ?? "dev",
            apiBasePath: "/api",
            googleClientId: googleClientId ?? "",
            appVersion: "local-dev",
          }),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), runtimeConfigOverride()],
  // Local development against a real or mock backend: point
  // ADMIN_DEV_PROXY at its origin and /api/* is forwarded with the
  // prefix stripped, mirroring the nginx container's behaviour.
  server:
    process.env.ADMIN_DEV_PROXY === undefined
      ? {}
      : {
          proxy: {
            "/api": {
              target: process.env.ADMIN_DEV_PROXY,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ""),
            },
          },
        },
  test: {
    environment: "jsdom",
    // Playwright owns e2e/; vitest would try to run it as a unit suite.
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
