import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AnalyticsBatchService } from "./analytics-batch.service";
import { AnalyticsController } from "./analytics.controller";
import {
  ANALYTICS_EXPORTER,
  NoOpAnalyticsExporter,
} from "./analytics-exporter";
import { AnalyticsOutboxWorker } from "./analytics-outbox.worker";
import { MetricKitController } from "./metrickit.controller";

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, MetricKitController],
  providers: [
    AnalyticsBatchService,
    AnalyticsOutboxWorker,
    { provide: ANALYTICS_EXPORTER, useClass: NoOpAnalyticsExporter },
  ],
})
export class AnalyticsModule {}
