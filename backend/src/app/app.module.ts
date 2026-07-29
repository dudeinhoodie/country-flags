import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { RequestIdMiddleware } from "../common/http/request-id.middleware";
import { LoggingModule } from "../common/logging/logging.module";
import { validateEnvironment } from "../config/environment.validation";
import { DatabaseModule } from "../infrastructure/database/database.module";
import { AuthModule } from "../modules/auth/auth.module";
import { AccountLifecycleModule } from "../modules/account-lifecycle/account-lifecycle.module";
import { ContentModule } from "../modules/content/content.module";
import { HealthModule } from "../modules/health/health.module";
import { ReviewsModule } from "../modules/reviews/reviews.module";
import { StudySessionsModule } from "../modules/study-sessions/study-sessions.module";
import { DevicesModule } from "../modules/devices/devices.module";
import { SettingsModule } from "../modules/settings/settings.module";
import { UsersModule } from "../modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    LoggingModule,
    DatabaseModule,
    AuthModule,
    AccountLifecycleModule,
    ContentModule,
    DevicesModule,
    HealthModule,
    ReviewsModule,
    StudySessionsModule,
    SettingsModule,
    UsersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
