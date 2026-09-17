import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Connect, Plugin, ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

const FIXTURES_DIRECTORY = fileURLToPath(
  new URL("./fixtures/documents", import.meta.url),
);

/**
 * Where the published documents come from while developing.
 *
 * In a deployment nginx proxies `/documents/` to the environment's bucket.
 * Locally there is no nginx, so the dev and preview servers either forward
 * to a real bucket (`SITE_DOCUMENTS_PROXY=https://storage.googleapis.com/…/documents`)
 * or answer from the committed fixtures. The fixtures never reach the image:
 * they live outside `public/`, and this middleware is the only thing that
 * serves them.
 */
function fixtureDocuments(): Plugin {
  const serve = (middlewares: Connect.Server): void => {
    middlewares.use((request, response, next) => {
      const path = request.url?.split("?")[0] ?? "";
      if (!path.startsWith("/documents/")) {
        next();
        return;
      }
      const name = path.slice("/documents/".length);
      if (!/^[a-z0-9.-]+\.json$/.test(name)) {
        response.statusCode = 404;
        response.end();
        return;
      }
      readFile(join(FIXTURES_DIRECTORY, name), "utf8").then(
        (body) => {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(body);
        },
        () => {
          // The bucket answers a missing document with a 404 and an XML
          // body; the page only reads the status, so the body is irrelevant.
          response.statusCode = 404;
          response.setHeader("Content-Type", "application/xml");
          response.end("<Error><Code>NoSuchKey</Code></Error>");
        },
      );
    });
  };
  return {
    name: "site-fixture-documents",
    configureServer(server) {
      serve(server.middlewares);
    },
    configurePreviewServer(server) {
      serve(server.middlewares);
    },
  };
}

function documentsProxy(): Record<string, ProxyOptions> | undefined {
  const upstream = process.env.SITE_DOCUMENTS_PROXY;
  if (upstream === undefined || upstream.trim() === "") {
    return undefined;
  }
  const target = new URL(upstream.replace(/\/+$/, ""));
  return {
    "/documents": {
      target: target.origin,
      changeOrigin: true,
      rewrite: (path) =>
        `${target.pathname}${path.replace(/^\/documents/, "")}`,
    },
  };
}

const proxy = documentsProxy();

export default defineConfig({
  plugins: [react(), ...(proxy === undefined ? [fixtureDocuments()] : [])],
  server: proxy === undefined ? {} : { proxy },
  preview: proxy === undefined ? {} : { proxy },
  test: {
    environment: "jsdom",
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
