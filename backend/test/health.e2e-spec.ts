import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app/app.module";

describe("Health endpoints (e2e)", () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();

    expressApp.disable("x-powered-by");
    expressApp.setGlobalPrefix("v1");
    await expressApp.init();
    app = expressApp;
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it("reports process liveness and preserves a valid request ID", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const response = await request(httpServer)
      .get("/v1/health/live")
      .set("X-Request-ID", requestId)
      .expect(200);

    expect(response.headers["x-request-id"]).toBe(requestId);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.body).toEqual({ status: "ok" });
  });

  it("replaces an invalid request ID", async () => {
    const response = await request(httpServer)
      .get("/v1/health/live")
      .set("X-Request-ID", "unsafe-request-id")
      .expect(200);

    expect(response.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("reports readiness when PostgreSQL is available", async () => {
    const response = await request(httpServer)
      .get("/v1/health/ready")
      .expect(200);

    const responseBody = response.body as {
      status: string;
      checks: {
        database: {
          status: string;
          latencyMs: number;
        };
      };
    };

    expect(responseBody).toMatchObject({
      status: "ok",
      checks: {
        database: {
          status: "up",
        },
      },
    });
    expect(responseBody.checks.database.latencyMs).toEqual(expect.any(Number));
  });
});
