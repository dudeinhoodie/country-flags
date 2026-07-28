import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { parse } from "yaml";

import { AppModule } from "../src/app/app.module";

const HTTP_METHODS = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
]);

interface ExpressRoute {
  path: string | string[];
  methods: Record<string, boolean>;
}

interface ExpressLayer {
  route?: ExpressRoute;
}

interface ExpressRouter {
  stack: ExpressLayer[];
}

interface ExpressApplicationWithRouter {
  router?: ExpressRouter;
  _router?: ExpressRouter;
}

interface OpenApiOperation {
  "x-implementation-status"?: "implemented" | "planned";
}

interface OpenApiDocument {
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

function normalizeExpressPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function collectRuntimeOperations(app: INestApplication): Set<string> {
  const expressApplication = app
    .getHttpAdapter()
    .getInstance() as ExpressApplicationWithRouter;
  const router = expressApplication.router ?? expressApplication._router;

  if (router === undefined) {
    throw new Error("Express router is unavailable for contract drift check");
  }

  const operations = new Set<string>();
  for (const layer of router.stack) {
    if (layer.route === undefined) {
      continue;
    }

    const paths = Array.isArray(layer.route.path)
      ? layer.route.path
      : [layer.route.path];
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (!enabled || method === "head" || method === "options") {
        continue;
      }
      for (const path of paths) {
        operations.add(operationKey(method, normalizeExpressPath(path)));
      }
    }
  }

  return operations;
}

function collectContractOperations(document: OpenApiDocument): {
  all: Set<string>;
  implemented: Set<string>;
} {
  const all = new Set<string>();
  const implemented = new Set<string>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue;
      }

      const key = operationKey(method, path);
      all.add(key);
      if (operation["x-implementation-status"] === "implemented") {
        implemented.add(key);
      }
    }
  }

  return { all, implemented };
}

describe("OpenAPI implementation drift (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps runtime routes aligned with implemented OpenAPI operations", async () => {
    const contractPath = resolve(__dirname, "../../contracts/openapi.yaml");
    const source = await readFile(contractPath, "utf8");
    const document = parse(source) as unknown as OpenApiDocument;
    const contract = collectContractOperations(document);
    const runtime = collectRuntimeOperations(app);

    expect([...runtime].sort()).toEqual([...contract.implemented].sort());
    expect([...runtime].every((route) => contract.all.has(route))).toBe(true);
  });
});
