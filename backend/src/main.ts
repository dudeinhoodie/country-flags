import "reflect-metadata";

import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { JsonLoggerService } from "./common/logging/json-logger.service";
import type { EnvironmentVariables } from "./config/environment.validation";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get<ConfigService<EnvironmentVariables>>(ConfigService);
  const logger = app.get(JsonLoggerService);
  const port = config.getOrThrow<number>("PORT");
  const environment = config.getOrThrow<string>("NODE_ENV");

  app.useLogger(logger);
  app.disable("x-powered-by");
  app.setGlobalPrefix("v1");
  app.enableShutdownHooks();

  await app.listen(port);

  logger.log({
    message: "Country Flags backend started",
    event: "application_started",
    port,
    environment,
  });
}

void bootstrap();
