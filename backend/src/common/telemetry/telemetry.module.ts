import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { MetricsService } from "./metrics.service";
import { shutdownTelemetry } from "./telemetry.bootstrap";
import { WorkerBacklogService } from "./worker-backlog.service";

@Injectable()
class TelemetryShutdownHook implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTelemetry();
  }
}

@Global()
@Module({
  providers: [MetricsService, WorkerBacklogService, TelemetryShutdownHook],
  exports: [MetricsService, WorkerBacklogService],
})
export class TelemetryModule {}
