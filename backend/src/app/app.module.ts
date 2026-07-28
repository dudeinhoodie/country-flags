import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { RequestIdMiddleware } from "../common/http/request-id.middleware";
import { LoggingModule } from "../common/logging/logging.module";
import { validateEnvironment } from "../config/environment.validation";
import { DatabaseModule } from "../infrastructure/database/database.module";
import { HealthModule } from "../modules/health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggingModule,
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
