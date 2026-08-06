import {
  Global,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { MetricsService } from "./metrics.service";
import { shutdownTelemetry } from "./telemetry.bootstrap";

@Injectable()
class TelemetryShutdownHook implements OnApplicationShutdown {
  onApplicationShutdown(): Promise<void> {
    return shutdownTelemetry();
  }
}

@Global()
@Module({
  providers: [MetricsService, TelemetryShutdownHook],
  exports: [MetricsService],
})
export class TelemetryModule {}
