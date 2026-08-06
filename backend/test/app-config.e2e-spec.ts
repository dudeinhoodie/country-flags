import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app/app.module";

describe("application configuration (integration)", () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns an evaluated default-off snapshot and honours ETag", async () => {
    const first = await request(httpServer)
      .get("/v1/app-config")
      .query({ platform: "ios", appVersion: "1.0.0", locale: "en" })
      .expect(200);
    const body = first.body as {
      configVersion: string;
      featureFlags: Record<string, { value: unknown }>;
      advertising: {
        enabled: boolean;
        mode: string;
        placements: Record<string, { enabled: boolean; format: string }>;
      };
    };
    expect(first.headers.etag).toBe(`"${body.configVersion}"`);
    expect(first.headers["cache-control"]).toBe("private, max-age=300");
    expect(body.featureFlags["study.multiple_choice.enabled"]).toEqual(
      expect.objectContaining({ value: false }),
    );
    expect(body.advertising).toMatchObject({
      enabled: false,
      mode: "DISABLED",
    });
    expect(Object.values(body.advertising.placements)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: false, format: "BANNER" }),
      ]),
    );
    expect(JSON.stringify(body)).not.toMatch(/secret|token|providerName/iu);

    const etag = first.headers.etag;
    if (typeof etag !== "string") {
      throw new Error("app-config response has no ETag");
    }
    await request(httpServer)
      .get("/v1/app-config")
      .query({ platform: "ios", appVersion: "1.0.0", locale: "en" })
      .set("If-None-Match", etag)
      .expect(304);
  });

  it("validates the app-config evaluation context", async () => {
    await request(httpServer)
      .get("/v1/app-config")
      .query({ platform: "watch", appVersion: "1.0", locale: "not a locale" })
      .expect(422);
  });
});
