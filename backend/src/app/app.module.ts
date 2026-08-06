import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";

import { ErrorsModule } from "../common/errors/errors.module";
import { HttpExceptionFilter } from "../common/http/http-exception.filter";
import { RequestIdMiddleware } from "../common/http/request-id.middleware";
import { LoggingModule } from "../common/logging/logging.module";
import { RateLimiterModule } from "../common/security/rate-limiter.module";
import { TelemetryModule } from "../common/telemetry/telemetry.module";
import { validateEnvironment } from "../config/environment.validation";
import { DatabaseModule } from "../infrastructure/database/database.module";
import { AuthModule } from "../modules/auth/auth.module";
import { AccountLifecycleModule } from "../modules/account-lifecycle/account-lifecycle.module";
import { AdvertisingPolicyModule } from "../modules/advertising/advertising-policy.module";
import { AnalyticsModule } from "../modules/analytics/analytics.module";
import { AppConfigModule } from "../modules/app-config/app-config.module";
import { ContentModule } from "../modules/content/content.module";
import { HealthModule } from "../modules/health/health.module";
import { ProgressModule } from "../modules/progress/progress.module";
import { ReviewsModule } from "../modules/reviews/reviews.module";
import { StudySessionsModule } from "../modules/study-sessions/study-sessions.module";
import { SyncModule } from "../modules/sync/sync.module";
import { DevicesModule } from "../modules/devices/devices.module";
import { FeatureFlagsModule } from "../modules/feature-flags/feature-flags.module";
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
    TelemetryModule,
    ErrorsModule,
    RateLimiterModule,
    DatabaseModule,
    AuthModule,
    AccountLifecycleModule,
    AnalyticsModule,
    FeatureFlagsModule,
    AdvertisingPolicyModule,
    AppConfigModule,
    ContentModule,
    DevicesModule,
    HealthModule,
    ProgressModule,
    ReviewsModule,
    StudySessionsModule,
    SyncModule,
    SettingsModule,
    UsersModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*splat}");
  }
}
