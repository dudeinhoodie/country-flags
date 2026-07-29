import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { RequestIdMiddleware } from "../common/http/request-id.middleware";
import { LoggingModule } from "../common/logging/logging.module";
import { validateEnvironment } from "../config/environment.validation";
import { DatabaseModule } from "../infrastructure/database/database.module";
import { ContentModule } from "../modules/content/content.module";
import { HealthModule } from "../modules/health/health.module";
import { StudySessionsModule } from "../modules/study-sessions/study-sessions.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggingModule,
    DatabaseModule,
    ContentModule,
    HealthModule,
    StudySessionsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
