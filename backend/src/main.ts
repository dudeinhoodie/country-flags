import "reflect-metadata";

import { bootstrapTelemetry } from "./common/telemetry/telemetry.bootstrap";

bootstrapTelemetry();

import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";

import { AppModule } from "./app/app.module";
import { JsonLoggerService } from "./common/logging/json-logger.service";
import type { EnvironmentVariables } from "./config/environment.validation";

const BODY_SIZE_LIMIT = "512kb";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get<ConfigService<EnvironmentVariables>>(ConfigService);
  const logger = app.get(JsonLoggerService);
  const port = config.getOrThrow<number>("PORT");
  const nodeEnvironment = config.getOrThrow<string>("NODE_ENV");
  const deploymentEnvironment = config.getOrThrow<string>("DEPLOYMENT_ENV");
  const corsAllowedOrigins = config.getOrThrow<string[]>(
    "CORS_ALLOWED_ORIGINS",
  );

  app.useLogger(logger);
  app.disable("x-powered-by");
  app.setGlobalPrefix("v1");
  // API-only backend that serves no HTML — CSP has nothing to protect and would only
  // add noise; the remaining helmet defaults (HSTS, X-Content-Type-Options, etc.) still apply.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: corsAllowedOrigins, credentials: false });
  app.useBodyParser("json", { limit: BODY_SIZE_LIMIT });
  app.useBodyParser("urlencoded", {
    limit: BODY_SIZE_LIMIT,
    extended: false,
  });
  app.enableShutdownHooks();

  await app.listen(port);

  logger.log({
    message: "Country Flags backend started",
    event: "application_started",
    port,
    // `environment` is the deployment environment, matching every other log
    // entry: dev and prod share NODE_ENV=production, so it is reported separately.
    environment: deploymentEnvironment,
    nodeEnv: nodeEnvironment,
  });
}

void bootstrap();
