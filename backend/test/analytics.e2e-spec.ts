import { createHash, randomUUID } from "node:crypto";
import type { Server } from "node:http";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app/app.module";
import { PrismaService } from "../src/infrastructure/database/prisma.service";
import { TestJwtSigner } from "../src/modules/auth/testing/test-jwt-signer";

interface BatchResultBody {
  results: Array<{
    eventId: string;
    status: "ACCEPTED" | "DUPLICATE" | "REJECTED";
    rejectionCode: string | null;
  }>;
  serverTime: string;
}

function analyticsEvent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    eventId: randomUUID(),
    eventName: "deck.opened",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    anonymousId: "a".repeat(20),
    sessionId: "s".repeat(10),
    context: {
      platform: "ios",
      appVersion: "1.0.0",
      build: "100",
      locale: "en",
    },
    properties: { deckType: "system" },
    ...overrides,
  };
}

describe("analytics ingestion, MetricKit, and privacy settings (integration)", () => {
  let app: INestApplication;
  let httpServer: Server;
  let database: PrismaService;
  let token: string;
  let userId: string;

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
    database = app.get(PrismaService);

    userId = randomUUID();
    await database.user.create({ data: { id: userId, preferredLocale: "en" } });
    token = app.get(TestJwtSigner).sign(userId);
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts a registered event without authentication", async () => {
    const event = analyticsEvent();
    const response = await request(httpServer)
      .post("/v1/analytics/events/batch")
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    const body = response.body as BatchResultBody;
    expect(body.results).toEqual([
      { eventId: event.eventId, status: "ACCEPTED", rejectionCode: null },
    ]);
  });

  it("treats a resubmitted eventId as a duplicate, not a second delivery", async () => {
    const event = analyticsEvent();
    const first = await request(httpServer)
      .post("/v1/analytics/events/batch")
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    expect((first.body as BatchResultBody).results[0]?.status).toBe("ACCEPTED");

    const second = await request(httpServer)
      .post("/v1/analytics/events/batch")
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    expect((second.body as BatchResultBody).results[0]?.status).toBe(
      "DUPLICATE",
    );
  });

  it("rejects an event not present in the registry", async () => {
    const event = analyticsEvent({ eventName: "not.a.real.event" });
    const response = await request(httpServer)
      .post("/v1/analytics/events/batch")
      .send({ payloadVersion: 1, events: [event] })
      .expect(200);
    expect((response.body as BatchResultBody).results[0]).toEqual({
      eventId: event.eventId,
      status: "REJECTED",
      rejectionCode: "UNKNOWN_EVENT",
    });
  });

  it("rejects a batch envelope that violates the request schema", async () => {
    await request(httpServer)
      .post("/v1/analytics/events/batch")
      .send({ payloadVersion: 1, events: [{ eventName: "deck.opened" }] })
      .expect(422);
  });

  it("uploads a sanitized MetricKit report and rejects a checksum mismatch", async () => {
    const payloadBytes = Buffer.from("fake gzip metrickit payload");
    const sha256 = createHash("sha256").update(payloadBytes).digest("hex");

    await request(httpServer)
      .post("/v1/diagnostics/metrickit")
      .send({
        reportId: randomUUID(),
        payloadVersion: 1,
        appVersion: "1.0.0",
        build: "100",
        generatedAt: new Date().toISOString(),
        encoding: "gzip_base64",
        sha256,
        payload: payloadBytes.toString("base64"),
      })
      .expect(202);

    await request(httpServer)
      .post("/v1/diagnostics/metrickit")
      .send({
        reportId: randomUUID(),
        payloadVersion: 1,
        appVersion: "1.0.0",
        build: "100",
        generatedAt: new Date().toISOString(),
        encoding: "gzip_base64",
        sha256: "0".repeat(64),
        payload: payloadBytes.toString("base64"),
      })
      .expect(422);
  });

  it("rejects an anonymous request to a personal endpoint", async () => {
    await request(httpServer).get("/v1/me/privacy-settings").expect(401);
  });

  describe("privacy settings and consent enforcement", () => {
    it("defaults to UNKNOWN, supports optimistic concurrency, and denying analytics drops pending events", async () => {
      const initial = await request(httpServer)
        .get("/v1/me/privacy-settings")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(initial.body).toMatchObject({
        productAnalyticsStatus: "UNKNOWN",
        diagnosticsStatus: "UNKNOWN",
        version: 1,
      });
      expect(initial.headers.etag).toBe('W/"1"');

      const event = analyticsEvent();
      await request(httpServer)
        .post("/v1/analytics/events/batch")
        .set("Authorization", `Bearer ${token}`)
        .send({ payloadVersion: 1, events: [event] })
        .expect(200);
      await expect(
        database.analyticsOutboxEvent.findUnique({
          where: { eventId: event.eventId as string },
        }),
      ).resolves.toMatchObject({ deliveryStatus: "PENDING" });

      await request(httpServer)
        .patch("/v1/me/privacy-settings")
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", 'W/"99"')
        .send({ productAnalyticsStatus: "DENIED" })
        .expect(409);

      const updated = await request(httpServer)
        .patch("/v1/me/privacy-settings")
        .set("Authorization", `Bearer ${token}`)
        .set("If-Match", 'W/"1"')
        .send({ productAnalyticsStatus: "DENIED" })
        .expect(200);
      expect(updated.body).toMatchObject({
        productAnalyticsStatus: "DENIED",
        version: 2,
      });

      await expect(
        database.analyticsOutboxEvent.findUnique({
          where: { eventId: event.eventId as string },
        }),
      ).resolves.toBeNull();

      const consentEvents = await database.privacyConsentEvent.findMany({
        where: { userId },
      });
      expect(consentEvents).toHaveLength(1);
      expect(consentEvents[0]).toMatchObject({
        category: "PRODUCT_ANALYTICS",
        previousStatus: "UNKNOWN",
        newStatus: "DENIED",
      });

      const rejectedEvent = analyticsEvent();
      const rejected = await request(httpServer)
        .post("/v1/analytics/events/batch")
        .set("Authorization", `Bearer ${token}`)
        .send({ payloadVersion: 1, events: [rejectedEvent] })
        .expect(200);
      expect((rejected.body as BatchResultBody).results[0]).toEqual({
        eventId: rejectedEvent.eventId,
        status: "REJECTED",
        rejectionCode: "CONSENT_DENIED",
      });
    });

    it("never blocks an essential_operations event, even while product analytics is denied", async () => {
      const event = analyticsEvent({
        eventId: randomUUID(),
        eventName: "sync.completed",
        properties: { result: "success", durationBucket: "under_1s" },
      });
      const response = await request(httpServer)
        .post("/v1/analytics/events/batch")
        .set("Authorization", `Bearer ${token}`)
        .send({ payloadVersion: 1, events: [event] })
        .expect(200);
      expect((response.body as BatchResultBody).results[0]).toEqual({
        eventId: event.eventId,
        status: "ACCEPTED",
        rejectionCode: null,
      });
    });
  });
});
